/**
 * src/config/attendance.ts
 *
 * Unified operational parameters for the attendance system.
 * A single source of truth — import from here, never hardcode constants inline.
 */

// ── Geofence ──────────────────────────────────────────────────────────────────

/** Maximum student-to-session horizontal distance (metres). */
export const GEOFENCE_MAX_HORIZONTAL_METERS = 15;

/** Maximum vertical altitude difference (metres, roughly 1 floor). */
export const GEOFENCE_MAX_ALTITUDE_DIFF_METERS = 3;

/**
 * Hard GPS accuracy threshold.
 * If the browser-reported accuracy exceeds this value the location is rejected
 * outright — an imprecise fix cannot be trusted for fine-grained geofencing.
 */
export const GEOFENCE_MAX_ACCURACY_METERS = 50;

// ── QR / Rotating token ───────────────────────────────────────────────────────

/** Duration of each rotating time window (milliseconds). */
export const TOKEN_WINDOW_MS = 3_000;

/**
 * Number of windows allowed as drift for scan/network delay.
 * e.g. 2 → accept tokens up to ±6 s old (2 × 3 s).
 */
export const TOKEN_ALLOWED_DRIFT_WINDOWS = 2;

// ── Attendance status thresholds ─────────────────────────────────────────────

/** Fraction of classes attended below which a low-attendance alert fires. */
export const LOW_ATTENDANCE_THRESHOLD = 0.75; // 75%

/**
 * Minutes after the official class start time that a check-in is still
 * counted as "present" (after which the status flips to "late").
 */
export const LATE_GRACE_PERIOD_MINUTES = 10;

// ── CSV import ────────────────────────────────────────────────────────────────

/** Number of rows processed per database upsert batch during CSV import. */
export const CSV_IMPORT_CHUNK_SIZE = 100;

// ── WebAuthn challenge ────────────────────────────────────────────────────────

/** How long (ms) a passkey challenge lives before expiring. */
export const CHALLENGE_TTL_MS = 60_000; // 60 seconds
