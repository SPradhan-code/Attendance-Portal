'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { ActiveSessionControl } from './ActiveSessionControl';
import type { Class } from '@/types/database';

interface AdminSessionManagerProps {
  classes: Class[];
  onSessionUpdated?: () => void;
}

export function AdminSessionManager({
  classes,
  onSessionUpdated,
}: AdminSessionManagerProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>(
    classes[0]?.id ?? '',
  );
  const [floor, setFloor] = useState<number>(1);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [activeSession, setActiveSession] = useState<{
    classId: string;
    className: string;
    latitude: number;
    longitude: number;
    altitude: number | null;
    floor: number;
  } | null>(null);

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [checkInUrl, setCheckInUrl] = useState<string>('');
  const [tokenStep, setTokenStep] = useState<number>(0);
  const [progress, setProgress] = useState<number>(100);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rotationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const cycleStartRef = useRef<number>(Date.now());
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Check if any class has an active session already
  useEffect(() => {
    const currentlyActive = classes.find((c) => c.is_session_active);
    if (currentlyActive) {
      setSelectedClassId(currentlyActive.id);
      setActiveSession({
        classId: currentlyActive.id,
        className: currentlyActive.name,
        latitude: Number(currentlyActive.session_latitude ?? currentlyActive.latitude),
        longitude: Number(currentlyActive.session_longitude ?? currentlyActive.longitude),
        altitude: currentlyActive.session_altitude != null ? Number(currentlyActive.session_altitude) : null,
        floor: currentlyActive.session_floor ?? 1,
      });
    }
  }, [classes]);

  // Fetch token and generate QR
  const fetchRotatingToken = useCallback(async (classId: string) => {
    try {
      const res = await fetch(`/api/classes/${classId}/session/token`);
      const data = await res.json();

      if (res.ok && data.checkInUrl) {
        setCheckInUrl(data.checkInUrl);
        setTokenStep(data.timeStep);

        const url = await QRCode.toDataURL(data.checkInUrl, {
          width: 380,
          margin: 2,
          color: {
            dark: '#030712',
            light: '#ffffff',
          },
          errorCorrectionLevel: 'M',
        });
        setQrDataUrl(url);

        cycleStartRef.current = Date.now();
      } else {
        console.warn('Failed to fetch rotating token:', data.error);
      }
    } catch (err) {
      console.error('Error fetching rotating token:', err);
    }
  }, []);

  // Set up 3-second interval and progress animation when session is active
  useEffect(() => {
    if (!activeSession) {
      if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    // Initial fetch
    fetchRotatingToken(activeSession.classId);

    // Refresh token every 3 seconds
    rotationTimerRef.current = setInterval(() => {
      fetchRotatingToken(activeSession.classId);
    }, 3000);

    // Smooth countdown progress bar
    const updateProgress = () => {
      const elapsed = Date.now() - cycleStartRef.current;
      const remainingPercent = Math.max(0, 100 - (elapsed / 3000) * 100);
      setProgress(remainingPercent);
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    };
    animationFrameRef.current = requestAnimationFrame(updateProgress);

    return () => {
      if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [activeSession, fetchRotatingToken]);

  // Start Session: Capture navigator.geolocation and submit
  const handleStartSession = () => {
    setErrorMsg(null);
    const targetClass = classes.find((c) => c.id === selectedClassId);
    if (!targetClass) {
      setErrorMsg('Please select a valid class.');
      return;
    }

    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setIsLocating(false);
        setIsStarting(true);

        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        const altitude = pos.coords.altitude != null ? pos.coords.altitude : null;

        try {
          const res = await fetch(`/api/classes/${targetClass.id}/session/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              latitude,
              longitude,
              altitude,
              floor,
            }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Failed to start session.');
          }

          setActiveSession({
            classId: targetClass.id,
            className: targetClass.name,
            latitude,
            longitude,
            altitude,
            floor,
          });

          if (onSessionUpdated) onSessionUpdated();
        } catch (err: unknown) {
          setErrorMsg(err instanceof Error ? err.message : 'Error starting session.');
        } finally {
          setIsStarting(false);
        }
      },
      (geoErr) => {
        setIsLocating(false);
        setErrorMsg(
          `Location access denied or timed out (${geoErr.message}). High-accuracy GPS is required for session initialization.`,
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  // End Session
  const handleEndSession = async () => {
    if (!activeSession) return;
    try {
      await fetch(`/api/classes/${activeSession.classId}/session/end`, {
        method: 'POST',
      });
      setActiveSession(null);
      setQrDataUrl('');
      if (onSessionUpdated) onSessionUpdated();
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  };

  const toggleFullscreen = () => {
    if (!modalRef.current) return;
    if (!document.fullscreenElement) {
      modalRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/20 p-6 shadow-xl backdrop-blur-md">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <span>📡</span> 3D Session & Rotating QR Generator
          </h2>
          <p className="mt-1 text-xs text-indigo-300">
            Initialize an active session with live 3D coordinates (Lat, Lng, Alt) and projected dynamic QR code.
          </p>
        </div>

        {activeSession && (
          <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
            <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            Live Session Active
          </span>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Control panel if not in active session */}
      {!activeSession ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-300">Select Class</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id} className="bg-gray-900">
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-300">
              Classroom Floor Indicator
            </label>
            <input
              type="number"
              min={-2}
              max={50}
              value={floor}
              onChange={(e) => setFloor(parseInt(e.target.value) || 1)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              placeholder="e.g. 1, 2, 3"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleStartSession}
              disabled={isLocating || isStarting || !selectedClassId}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:brightness-110 disabled:opacity-50"
            >
              {isLocating ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Acquiring GPS 3D Coords...
                </>
              ) : isStarting ? (
                'Initializing Session...'
              ) : (
                <>
                  <span>🚀</span> Initialize 3D Session
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Active Session Projector Modal / Display */
        <div
          ref={modalRef}
          className={`flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-gray-950 via-gray-900 to-black p-6 text-center ${
            isFullscreen ? 'fixed inset-0 z-50 p-12' : 'relative'
          }`}
        >
          {/* Header & Controls */}
          <div className="mb-4 flex w-full flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <div className="text-left">
              <span className="text-xs uppercase tracking-wider text-indigo-400">Class In Session</span>
              <h3 className="text-xl font-bold text-white">{activeSession.className}</h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleFullscreen}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10"
              >
                {isFullscreen ? 'Exit Fullscreen' : '⛶ Projector Mode'}
              </button>
              <button
                onClick={handleEndSession}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20"
              >
                Stop Session
              </button>
            </div>
          </div>

          {/* 3D Telemetry Badges */}
          <div className="mb-6 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-white/5 bg-white/5 p-2 text-center">
              <span className="block text-[10px] text-gray-400">Latitude</span>
              <span className="text-xs font-mono font-medium text-emerald-300">
                {activeSession.latitude.toFixed(6)}°
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 p-2 text-center">
              <span className="block text-[10px] text-gray-400">Longitude</span>
              <span className="text-xs font-mono font-medium text-emerald-300">
                {activeSession.longitude.toFixed(6)}°
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 p-2 text-center">
              <span className="block text-[10px] text-gray-400">Altitude (Z)</span>
              <span className="text-xs font-mono font-medium text-sky-300">
                {activeSession.altitude != null ? `${activeSession.altitude.toFixed(1)} m` : 'Standard'}
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 p-2 text-center">
              <span className="block text-[10px] text-gray-400">Target Floor</span>
              <span className="text-xs font-mono font-medium text-purple-300">
                Floor {activeSession.floor}
              </span>
            </div>
          </div>

          {/* Rotating Dynamic QR Code */}
          <div className="relative mb-4 flex flex-col items-center justify-center rounded-2xl bg-white p-4 shadow-2xl">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Rotating Check-In QR Code"
                className="h-64 w-64 rounded-xl sm:h-72 sm:w-72"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center text-gray-400">
                Generating QR...
              </div>
            )}

            {/* Rotating crypto pulse indicator */}
            <div className="mt-2 flex items-center gap-2 text-xs font-medium text-gray-800">
              <span className="h-2 w-2 animate-ping rounded-full bg-indigo-600" />
              <span>Rotates every 3 seconds (Token #{tokenStep})</span>
            </div>
          </div>

          {/* Progress bar for 3s rotation */}
          <div className="mb-4 h-1.5 w-64 overflow-hidden rounded-full bg-gray-800 sm:w-72">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-75"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="max-w-md text-xs text-gray-400">
            Students scan this QR code with their mobile device to open the 3D Geofenced Check-In page.
            Distance is limited to <span className="text-indigo-300 font-semibold">15 meters</span> and vertical altitude to <span className="text-indigo-300 font-semibold">3 meters</span>.
          </p>

          {/* Direct check-in link copy button */}
          {checkInUrl && (
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(checkInUrl);
                  alert('Check-in link copied to clipboard!');
                }}
                className="text-xs text-indigo-400 underline underline-offset-4 hover:text-indigo-300"
              >
                Copy live check-in link
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Real-Time Active Session Control Panel ──────────────── */}
      <div className="mt-8 border-t border-white/10 pt-8">
        <ActiveSessionControl
          classId={activeSession ? activeSession.classId : selectedClassId}
          className={
            activeSession
              ? activeSession.className
              : classes.find((c) => c.id === selectedClassId)?.name || 'Selected Class'
          }
          isSessionActive={!!activeSession}
        />
      </div>
    </div>
  );
}
