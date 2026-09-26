'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AttendanceStatus } from '@/types/database';

interface RosterStudent {
  studentId: string;
  name: string;
  email: string;
  rollNumber: string;
  isCheckedIn: boolean;
  attendanceId: string | null;
  status: AttendanceStatus;
  timestamp: string | null;
  distanceMeters: number | null;
  altitudeDiffMeters: number | null;
  verificationMethod: string | null;
}

interface AttendanceSummary {
  totalStudents: number;
  checkedInCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
}

interface ActiveSessionControlProps {
  classId: string;
  className: string;
  isSessionActive: boolean;
}

export function ActiveSessionControl({
  classId,
  className,
  isSessionActive,
}: ActiveSessionControlProps) {
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>({
    totalStudents: 0,
    checkedInCount: 0,
    presentCount: 0,
    lateCount: 0,
    absentCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUpdatingId, setIsUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTab, setFilterTab] = useState<'all' | 'present' | 'late' | 'absent'>('all');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch real-time check-ins
  const fetchAttendance = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const res = await fetch(`/api/classes/${classId}/attendance`);
      const data = await res.json();
      if (res.ok) {
        setRoster(data.roster || []);
        if (data.summary) {
          setSummary(data.summary);
        }
        setLastRefreshedAt(new Date());
      }
    } catch (err) {
      console.error('Error fetching live attendance:', err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [classId]);

  // Set up real-time polling during active session (every 3 seconds)
  useEffect(() => {
    fetchAttendance(true);

    if (isSessionActive) {
      pollIntervalRef.current = setInterval(() => {
        fetchAttendance(false);
      }, 3000);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [classId, isSessionActive, fetchAttendance]);

  // Manually toggle attendance status
  const handleToggleStatus = async (
    studentId: string,
    newStatus: AttendanceStatus,
  ) => {
    setIsUpdatingId(studentId);

    // Optimistic UI update
    setRoster((prev) =>
      prev.map((s) => {
        if (s.studentId === studentId) {
          return {
            ...s,
            status: newStatus,
            isCheckedIn: newStatus !== 'absent',
            verificationMethod: 'professor_manual_override',
            timestamp: s.timestamp || new Date().toISOString(),
          };
        }
        return s;
      }),
    );

    try {
      const res = await fetch(`/api/classes/${classId}/attendance/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          status: newStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update status.');
      }

      // Re-fetch to sync counts
      fetchAttendance(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error toggling status');
      fetchAttendance(false);
    } finally {
      setIsUpdatingId(null);
    }
  };

  const filteredRoster = roster.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filterTab === 'all') return true;
    return s.status === filterTab;
  });

  const attendanceRate =
    summary.totalStudents > 0
      ? Math.round((summary.checkedInCount / summary.totalStudents) * 100)
      : 0;

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900 to-black p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
      {/* Header & Live Status */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🎛️</span>
            <h3 className="text-xl font-bold text-white">Active Session Control Panel</h3>
            {isSessionActive && (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                Live Monitoring (3s poll)
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            Real-time feed for <span className="text-indigo-300 font-semibold">{className}</span>.
            View incoming student check-ins and manually override attendance in real time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            Updated: {lastRefreshedAt.toLocaleTimeString()}
          </span>
          <button
            onClick={() => fetchAttendance(false)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition"
          >
            ↻ Refresh Now
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-center">
          <span className="block text-xs text-gray-400 font-medium">Total Cohort</span>
          <span className="text-2xl font-bold text-white">{summary.totalStudents}</span>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-center">
          <span className="block text-xs text-emerald-400 font-medium">Present (On-Time)</span>
          <span className="text-2xl font-bold text-emerald-300">{summary.presentCount}</span>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-center">
          <span className="block text-xs text-amber-400 font-medium">Late Check-Ins</span>
          <span className="text-2xl font-bold text-amber-300">{summary.lateCount}</span>
        </div>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-center">
          <span className="block text-xs text-rose-400 font-medium">Absent</span>
          <span className="text-2xl font-bold text-rose-300">{summary.absentCount}</span>
        </div>
        <div className="col-span-2 sm:col-span-1 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 text-center">
          <span className="block text-xs text-indigo-400 font-medium">Attendance Rate</span>
          <span className="text-2xl font-bold text-indigo-300">{attendanceRate}%</span>
        </div>
      </div>

      {/* Filter and Search controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(['all', 'present', 'late', 'absent'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${
                filterTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              {tab} ({tab === 'all' ? roster.length : roster.filter((r) => r.status === tab).length})
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter student or roll #..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-56 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Roster Table with Manual Toggle Controls */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-gray-500">Loading active session roster...</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 bg-white/5">
                <th className="p-3">Roll Number</th>
                <th className="p-3">Student Name</th>
                <th className="p-3">Check-In Time</th>
                <th className="p-3">3D Telemetry</th>
                <th className="p-3">Method</th>
                <th className="p-3 text-right">Manual Status Toggle</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoster.map((student) => {
                const isSaving = isUpdatingId === student.studentId;
                return (
                  <tr
                    key={student.studentId}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition"
                  >
                    <td className="p-3 font-mono font-semibold text-indigo-300">
                      {student.rollNumber}
                    </td>
                    <td className="p-3">
                      <span className="font-medium text-white block">{student.name}</span>
                      <span className="text-[10px] text-gray-500">{student.email}</span>
                    </td>
                    <td className="p-3 text-gray-300">
                      {student.timestamp ? (
                        new Date(student.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {student.distanceMeters != null ? (
                        <div className="space-y-0.5">
                          <span className="block font-mono text-[11px] text-emerald-400">
                            📍 {student.distanceMeters.toFixed(1)}m away
                          </span>
                          {student.altitudeDiffMeters != null && (
                            <span className="block font-mono text-[10px] text-sky-400">
                              ↕ Δ{student.altitudeDiffMeters.toFixed(1)}m alt
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-600">No GPS record</span>
                      )}
                    </td>
                    <td className="p-3">
                      {student.verificationMethod === 'webauthn_geofence_3d' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/20">
                          🔐 WebAuthn 3D
                        </span>
                      ) : student.verificationMethod === 'professor_manual_override' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-300 border border-purple-500/20">
                          👤 Manual Override
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-500/10 px-2 py-0.5 text-[10px] text-gray-500 border border-gray-500/20">
                          Unverified
                        </span>
                      )}
                    </td>

                    {/* Interactive Manual Toggle Buttons */}
                    <td className="p-3 text-right">
                      <div className="inline-flex rounded-xl bg-black/60 p-1 border border-white/10 gap-1">
                        <button
                          onClick={() => handleToggleStatus(student.studentId, 'present')}
                          disabled={isSaving}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                            student.status === 'present'
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                              : 'text-gray-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                          }`}
                        >
                          Present
                        </button>
                        <button
                          onClick={() => handleToggleStatus(student.studentId, 'late')}
                          disabled={isSaving}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                            student.status === 'late'
                              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                              : 'text-gray-400 hover:text-amber-300 hover:bg-amber-500/10'
                          }`}
                        >
                          Late
                        </button>
                        <button
                          onClick={() => handleToggleStatus(student.studentId, 'absent')}
                          disabled={isSaving}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                            student.status === 'absent'
                              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                              : 'text-gray-400 hover:text-rose-300 hover:bg-rose-500/10'
                          }`}
                        >
                          Absent
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRoster.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    No students match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
