/**
 * Check-in timer — a dead-man's switch.
 *
 * You say when you expect to be safe. If you do not cancel by then, SafeSignal
 * raises the alert for you.
 *
 * This exists because the sensor pipeline covers the wrong half of the problem.
 * Voice stress needs you to be speaking, and the hand signal needs you to hold a
 * visible gesture at a camera — but someone genuinely threatened goes quiet and
 * still. A check-in inverts that: the dangerous case requires *no action at all*
 * from you, which is the only thing that reliably works when acting is exactly
 * what you cannot do.
 *
 * All state is derived from stored timestamps rather than a running timer, so
 * an expiry is honoured even if the tab was closed, the phone slept, or the
 * browser was killed in between.
 */

import { readJSON, writeJSON, removeKey } from './storage.js';

export const CHECK_IN_KEY = 'safesignal.checkIn';

/**
 * Grace period after expiry before the alert is raised.
 *
 * People forget. A short, loud window to say "I'm fine" turns a lapse of memory
 * into a dismissed notification rather than a contact being woken at 2am.
 */
export const GRACE_MS = 60_000;

/**
 * Offered durations, in minutes.
 *
 * Short by design. Someone setting this is often already uneasy and in a
 * hurry, and a short timer that gets extended is far safer than a long one
 * that leaves them unwatched. "+15 min" covers the case where it was too short.
 */
export const DURATION_PRESETS = [5, 10, 15];

/** Longest timer we will accept, to catch a mis-typed custom value. */
export const MAX_DURATION_MS = 12 * 60 * 60 * 1000;

/** The same limit in minutes, for the custom input. */
export const MAX_DURATION_MINUTES = MAX_DURATION_MS / 60_000;

/**
 * Validate a hand-typed duration.
 *
 * Kept here rather than in the component so the rules are testable, and so the
 * error text is specific: a timer that silently refuses to start would be a bad
 * failure for this feature in particular.
 *
 * @param {string|number} value - minutes, as typed
 * @returns {{ ok: true, minutes: number } | { ok: false, error: string }}
 */
export const validateCustomMinutes = (value) => {
    const trimmed = String(value ?? '').trim();

    if (trimmed === '') {
        return { ok: false, error: 'Enter how many minutes.' };
    }

    const minutes = Number(trimmed);

    if (!Number.isFinite(minutes)) {
        return { ok: false, error: 'Enter a number of minutes, like 40.' };
    }
    if (!Number.isInteger(minutes)) {
        return { ok: false, error: 'Use whole minutes, like 40.' };
    }
    if (minutes < 1) {
        return { ok: false, error: 'Use at least 1 minute.' };
    }
    if (minutes > MAX_DURATION_MINUTES) {
        return { ok: false, error: `The longest is ${MAX_DURATION_MINUTES / 60} hours.` };
    }

    return { ok: true, minutes };
};

/**
 * @typedef {Object} CheckIn
 * @property {string} id
 * @property {number} startedAt
 * @property {number} expiresAt
 * @property {string} note - what the user is doing, included in the alert
 * @property {'active'|'fired'} status
 * @property {number|null} firedAt
 */

/**
 * @typedef {'none'|'counting'|'grace'|'fire'|'fired'} CheckInPhase
 */

/**
 * Work out where a check-in stands right now.
 *
 * Pure and time-injected so the whole state machine is testable without
 * waiting in real time.
 *
 * @param {CheckIn|null} record
 * @param {number} now
 * @returns {{phase: CheckInPhase, remainingMs: number, graceRemainingMs: number, overdueMs: number}}
 */
export const evaluateCheckIn = (record, now = Date.now()) => {
    const idle = { phase: 'none', remainingMs: 0, graceRemainingMs: 0, overdueMs: 0 };

    if (!record || typeof record.expiresAt !== 'number') return idle;
    if (record.status === 'fired') {
        return { ...idle, phase: 'fired', overdueMs: Math.max(0, now - record.expiresAt) };
    }

    const remainingMs = record.expiresAt - now;
    if (remainingMs > 0) {
        return { phase: 'counting', remainingMs, graceRemainingMs: GRACE_MS, overdueMs: 0 };
    }

    const overdueMs = now - record.expiresAt;
    if (overdueMs < GRACE_MS) {
        return {
            phase: 'grace',
            remainingMs: 0,
            graceRemainingMs: GRACE_MS - overdueMs,
            overdueMs,
        };
    }

    return { phase: 'fire', remainingMs: 0, graceRemainingMs: 0, overdueMs };
};

/**
 * Begin a check-in.
 *
 * @param {number} durationMs
 * @param {string} note
 * @param {number} now
 * @returns {CheckIn|null} null if the duration is not usable
 */
export const startCheckIn = (durationMs, note = '', now = Date.now()) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
        return null;
    }

    const record = {
        id: `checkin-${now}`,
        startedAt: now,
        expiresAt: now + durationMs,
        note: String(note).trim().slice(0, 200),
        status: 'active',
        firedAt: null,
    };

    writeJSON(CHECK_IN_KEY, record);
    return record;
};

/**
 * Push the deadline back without losing the note.
 *
 * @param {CheckIn} record
 * @param {number} extraMs
 * @param {number} now
 * @returns {CheckIn|null}
 */
export const extendCheckIn = (record, extraMs, now = Date.now()) => {
    if (!record || !Number.isFinite(extraMs) || extraMs <= 0) return record ?? null;

    // Extend from now rather than from the old deadline, so extending something
    // already overdue gives the full extra time rather than expiring instantly.
    const base = Math.max(record.expiresAt, now);
    const expiresAt = Math.min(base + extraMs, now + MAX_DURATION_MS);

    const updated = { ...record, expiresAt, status: 'active', firedAt: null };
    writeJSON(CHECK_IN_KEY, updated);
    return updated;
};

/** Clear the check-in entirely. */
export const cancelCheckIn = () => {
    removeKey(CHECK_IN_KEY);
};

/**
 * Mark a check-in as having fired, so reopening the app does not raise it again.
 *
 * @param {CheckIn} record
 * @param {number} now
 * @returns {CheckIn}
 */
export const markCheckInFired = (record, now = Date.now()) => {
    const updated = { ...record, status: 'fired', firedAt: now };
    writeJSON(CHECK_IN_KEY, updated);
    return updated;
};

/**
 * Read the stored check-in, discarding anything malformed.
 * @returns {CheckIn|null}
 */
export const loadCheckIn = () => {
    const raw = readJSON(CHECK_IN_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt)) return null;

    return {
        id: String(raw.id ?? 'checkin'),
        startedAt: Number(raw.startedAt) || 0,
        expiresAt: raw.expiresAt,
        note: typeof raw.note === 'string' ? raw.note : '',
        status: raw.status === 'fired' ? 'fired' : 'active',
        firedAt: Number.isFinite(raw.firedAt) ? raw.firedAt : null,
    };
};

/**
 * Human-readable countdown, e.g. "1h 04m" or "0:45".
 * @param {number} ms
 * @returns {string}
 */
export const formatRemaining = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
};

/**
 * Duration label for a preset.
 * @param {number} minutes
 * @returns {string}
 */
export const formatDuration = (minutes) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
};

/**
 * Reason text attached to an alert raised by a missed check-in.
 * @param {CheckIn} record
 * @returns {string}
 */
export const describeCheckInReason = (record) => {
    const due = new Date(record.expiresAt).toLocaleTimeString();
    return record.note
        ? `No check-in by ${due} — "${record.note}"`
        : `No check-in by ${due}`;
};
