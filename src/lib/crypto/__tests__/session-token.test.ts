/**
 * src/lib/crypto/__tests__/session-token.test.ts
 *
 * Unit tests for the rotating QR session token logic.
 * Coverage targets: generateRotatingToken, verifyRotatingToken, getCurrentTimeStep
 */

import { describe, it, expect } from 'vitest';
import {
  generateRotatingToken,
  verifyRotatingToken,
  getCurrentTimeStep,
  ROTATING_WINDOW_MS,
  ALLOWED_DRIFT_WINDOWS,
} from '../session-token';

const CLASS_ID = 'class-abc-123';
const SECRET = 'super-secret-test-key-minimum-32b!';

describe('getCurrentTimeStep', () => {
  it('returns an integer', () => {
    const step = getCurrentTimeStep();
    expect(Number.isInteger(step)).toBe(true);
  });

  it('increments after one window', () => {
    const t = 1_000_000;
    const s1 = getCurrentTimeStep(t);
    const s2 = getCurrentTimeStep(t + ROTATING_WINDOW_MS);
    expect(s2).toBe(s1 + 1);
  });

  it('accepts a custom timestamp', () => {
    expect(getCurrentTimeStep(0)).toBe(0);
    expect(getCurrentTimeStep(ROTATING_WINDOW_MS)).toBe(1);
    expect(getCurrentTimeStep(ROTATING_WINDOW_MS * 5)).toBe(5);
  });
});

describe('generateRotatingToken', () => {
  it('returns token, timeStep, and expiresAt', () => {
    const { token, timeStep, expiresAt } = generateRotatingToken(
      CLASS_ID,
      SECRET,
    );
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(2);
    expect(typeof timeStep).toBe('number');
    expect(typeof expiresAt).toBe('number');
  });

  it('expiresAt is after current time', () => {
    const now = Date.now();
    const { expiresAt } = generateRotatingToken(CLASS_ID, SECRET, now);
    expect(expiresAt).toBeGreaterThan(now);
  });

  it('generates different tokens for different classIds', () => {
    const now = Date.now();
    const { token: t1 } = generateRotatingToken('class-1', SECRET, now);
    const { token: t2 } = generateRotatingToken('class-2', SECRET, now);
    expect(t1).not.toBe(t2);
  });

  it('generates different tokens for different secrets', () => {
    const now = Date.now();
    const { token: t1 } = generateRotatingToken(CLASS_ID, 'secret-aaa', now);
    const { token: t2 } = generateRotatingToken(CLASS_ID, 'secret-bbb', now);
    expect(t1).not.toBe(t2);
  });

  it('generates same token within same time window', () => {
    const now = Date.now();
    const windowStart = now - (now % ROTATING_WINDOW_MS);
    const { token: t1 } = generateRotatingToken(CLASS_ID, SECRET, windowStart);
    const { token: t2 } = generateRotatingToken(CLASS_ID, SECRET, windowStart + 100);
    expect(t1).toBe(t2);
  });
});

describe('verifyRotatingToken', () => {
  it('verifies a freshly generated token', () => {
    const now = Date.now();
    const { token } = generateRotatingToken(CLASS_ID, SECRET, now);
    const result = verifyRotatingToken(CLASS_ID, token, SECRET, ALLOWED_DRIFT_WINDOWS, now);
    expect(result.valid).toBe(true);
  });

  it('rejects an empty token', () => {
    const result = verifyRotatingToken(CLASS_ID, '', SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('rejects a malformed token (no dot)', () => {
    const result = verifyRotatingToken(CLASS_ID, 'nodothere', SECRET);
    expect(result.valid).toBe(false);
  });

  it('rejects a token with non-numeric timeStep', () => {
    const result = verifyRotatingToken(CLASS_ID, 'abc.signature', SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/time step/i);
  });

  it('rejects a token with wrong secret', () => {
    const now = Date.now();
    const { token } = generateRotatingToken(CLASS_ID, SECRET, now);
    const result = verifyRotatingToken(CLASS_ID, token, 'wrong-secret', ALLOWED_DRIFT_WINDOWS, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it('rejects an expired token (beyond drift window)', () => {
    const pastTimestamp = Date.now() - ROTATING_WINDOW_MS * (ALLOWED_DRIFT_WINDOWS + 5) * 1000;
    const { token } = generateRotatingToken(CLASS_ID, SECRET, pastTimestamp);
    const result = verifyRotatingToken(CLASS_ID, token, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired|older/i);
  });

  it('accepts a token within the allowed drift window', () => {
    const now = Date.now();
    // Token from exactly ALLOWED_DRIFT_WINDOWS windows ago
    const pastTimestamp = now - ROTATING_WINDOW_MS * ALLOWED_DRIFT_WINDOWS;
    const { token } = generateRotatingToken(CLASS_ID, SECRET, pastTimestamp);
    const result = verifyRotatingToken(CLASS_ID, token, SECRET, ALLOWED_DRIFT_WINDOWS, now);
    expect(result.valid).toBe(true);
  });

  it('rejects a token just outside the allowed drift window', () => {
    const now = Date.now();
    const tooOld = now - ROTATING_WINDOW_MS * (ALLOWED_DRIFT_WINDOWS + 1);
    const { token } = generateRotatingToken(CLASS_ID, SECRET, tooOld);
    const result = verifyRotatingToken(CLASS_ID, token, SECRET, ALLOWED_DRIFT_WINDOWS, now);
    expect(result.valid).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const now = Date.now();
    const { token } = generateRotatingToken(CLASS_ID, SECRET, now);
    const [step] = token.split('.');
    const tampered = `${step}.AAAA_tampered_BBBB`;
    const result = verifyRotatingToken(CLASS_ID, tampered, SECRET, ALLOWED_DRIFT_WINDOWS, now);
    expect(result.valid).toBe(false);
  });

  it('rejects when classId does not match generation classId', () => {
    const now = Date.now();
    const { token } = generateRotatingToken('class-original', SECRET, now);
    const result = verifyRotatingToken('class-different', token, SECRET, ALLOWED_DRIFT_WINDOWS, now);
    expect(result.valid).toBe(false);
  });
});
