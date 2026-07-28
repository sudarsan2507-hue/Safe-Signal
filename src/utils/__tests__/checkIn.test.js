import { describe, it, expect, beforeEach } from 'vitest';
import {
    evaluateCheckIn,
    startCheckIn,
    extendCheckIn,
    cancelCheckIn,
    markCheckInFired,
    loadCheckIn,
    formatRemaining,
    formatDuration,
    describeCheckInReason,
    GRACE_MS,
    MAX_DURATION_MS,
    CHECK_IN_KEY,
} from '../checkIn.js';

const T0 = 1_800_000_000_000;
const MINUTE = 60_000;

beforeEach(() => {
    window.localStorage.clear();
});

describe('startCheckIn', () => {
    it('stores a record that expires after the given duration', () => {
        const record = startCheckIn(30 * MINUTE, 'Walking home', T0);
        expect(record.expiresAt).toBe(T0 + 30 * MINUTE);
        expect(record.note).toBe('Walking home');
        expect(record.status).toBe('active');
        expect(loadCheckIn().expiresAt).toBe(record.expiresAt);
    });

    it('rejects durations that cannot be meant', () => {
        expect(startCheckIn(0, '', T0)).toBeNull();
        expect(startCheckIn(-5, '', T0)).toBeNull();
        expect(startCheckIn(NaN, '', T0)).toBeNull();
        expect(startCheckIn(MAX_DURATION_MS + 1, '', T0)).toBeNull();
    });

    it('truncates an over-long note', () => {
        const record = startCheckIn(MINUTE, 'x'.repeat(500), T0);
        expect(record.note.length).toBe(200);
    });
});

describe('evaluateCheckIn', () => {
    it('reports nothing when there is no check-in', () => {
        expect(evaluateCheckIn(null, T0).phase).toBe('none');
        expect(evaluateCheckIn({}, T0).phase).toBe('none');
    });

    it('counts down while time remains', () => {
        const record = startCheckIn(30 * MINUTE, '', T0);
        const state = evaluateCheckIn(record, T0 + 10 * MINUTE);
        expect(state.phase).toBe('counting');
        expect(state.remainingMs).toBe(20 * MINUTE);
    });

    it('enters the grace period at expiry rather than firing immediately', () => {
        // Forgetting is far more likely than danger, so a lapse should be
        // recoverable without waking anyone.
        const record = startCheckIn(30 * MINUTE, '', T0);
        const state = evaluateCheckIn(record, T0 + 30 * MINUTE + 1000);
        expect(state.phase).toBe('grace');
        expect(state.graceRemainingMs).toBe(GRACE_MS - 1000);
    });

    it('fires once the grace period lapses', () => {
        const record = startCheckIn(30 * MINUTE, '', T0);
        const state = evaluateCheckIn(record, T0 + 30 * MINUTE + GRACE_MS);
        expect(state.phase).toBe('fire');
    });

    it('fires for a deadline missed while the app was closed', () => {
        // The entire point of a dead-man's switch: state is derived from
        // timestamps, so nothing depends on a timer having stayed alive.
        const record = startCheckIn(30 * MINUTE, '', T0);
        const muchLater = T0 + 8 * 60 * MINUTE;
        const state = evaluateCheckIn(record, muchLater);
        expect(state.phase).toBe('fire');
        expect(state.overdueMs).toBeGreaterThan(GRACE_MS);
    });

    it('does not fire twice for the same check-in', () => {
        const record = startCheckIn(30 * MINUTE, '', T0);
        const fired = markCheckInFired(record, T0 + 31 * MINUTE);
        const state = evaluateCheckIn(fired, T0 + 60 * MINUTE);
        expect(state.phase).toBe('fired');
    });
});

describe('extendCheckIn', () => {
    it('pushes the deadline back', () => {
        const record = startCheckIn(30 * MINUTE, '', T0);
        const extended = extendCheckIn(record, 15 * MINUTE, T0 + 10 * MINUTE);
        expect(extended.expiresAt).toBe(T0 + 45 * MINUTE);
    });

    it('gives the full extension when already overdue', () => {
        // Extending from the stale deadline would expire again instantly.
        const record = startCheckIn(30 * MINUTE, '', T0);
        const now = T0 + 40 * MINUTE;
        const extended = extendCheckIn(record, 15 * MINUTE, now);
        expect(extended.expiresAt).toBe(now + 15 * MINUTE);
        expect(evaluateCheckIn(extended, now).phase).toBe('counting');
    });

    it('reactivates a check-in that had fired', () => {
        const record = startCheckIn(30 * MINUTE, '', T0);
        const fired = markCheckInFired(record, T0 + 31 * MINUTE);
        const extended = extendCheckIn(fired, 15 * MINUTE, T0 + 32 * MINUTE);
        expect(extended.status).toBe('active');
        expect(extended.firedAt).toBeNull();
    });

    it('keeps the note', () => {
        const record = startCheckIn(30 * MINUTE, 'Cycling back', T0);
        expect(extendCheckIn(record, MINUTE, T0).note).toBe('Cycling back');
    });

    it('will not extend beyond the maximum', () => {
        const record = startCheckIn(MINUTE, '', T0);
        const extended = extendCheckIn(record, MAX_DURATION_MS * 2, T0);
        expect(extended.expiresAt).toBeLessThanOrEqual(T0 + MAX_DURATION_MS);
    });
});

describe('cancelCheckIn', () => {
    it('clears the stored record', () => {
        startCheckIn(30 * MINUTE, '', T0);
        cancelCheckIn();
        expect(loadCheckIn()).toBeNull();
        expect(evaluateCheckIn(loadCheckIn(), T0 + 60 * MINUTE).phase).toBe('none');
    });
});

describe('loadCheckIn', () => {
    it('returns null for corrupt storage', () => {
        window.localStorage.setItem(CHECK_IN_KEY, '{not json');
        expect(loadCheckIn()).toBeNull();
    });

    it('rejects a record with no usable expiry', () => {
        window.localStorage.setItem(CHECK_IN_KEY, JSON.stringify({ id: 'x', expiresAt: 'soon' }));
        expect(loadCheckIn()).toBeNull();
    });
});

describe('formatting', () => {
    it('formats remaining time by magnitude', () => {
        expect(formatRemaining(45_000)).toBe('45s');
        expect(formatRemaining(5 * MINUTE + 3000)).toBe('5m 03s');
        expect(formatRemaining(64 * MINUTE)).toBe('1h 04m');
        expect(formatRemaining(-1000)).toBe('0s');
    });

    it('formats durations', () => {
        expect(formatDuration(15)).toBe('15 min');
        expect(formatDuration(60)).toBe('1 hour');
        expect(formatDuration(120)).toBe('2 hours');
    });

    it('includes the note in the alert reason', () => {
        const record = startCheckIn(30 * MINUTE, 'Walking home', T0);
        expect(describeCheckInReason(record)).toContain('Walking home');
        expect(describeCheckInReason({ ...record, note: '' })).toMatch(/No check-in by/);
    });
});
