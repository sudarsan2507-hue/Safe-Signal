import { describe, it, expect } from 'vitest';
import {
    IncidentLog,
    EVENT,
    summariseSnapshot,
    summariseTrigger,
    describeMoment,
    formatRisk,
    MAX_ENTRIES,
} from '../incidentLog.js';

const T0 = 1_800_000_000_000;

describe('IncidentLog', () => {
    it('records entries in order', () => {
        const log = new IncidentLog();
        log.record(EVENT.PROTECTION_ON, {}, T0);
        log.record(EVENT.READING, { risk: 0.2 }, T0 + 1000);

        const entries = log.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries[0].type).toBe(EVENT.PROTECTION_ON);
        expect(entries[1].risk).toBe(0.2);
    });

    it('bounds the buffer so a long session cannot grow without limit', () => {
        const log = new IncidentLog(10);
        for (let i = 0; i < 50; i++) {
            log.record(EVENT.READING, { risk: i / 50 }, T0 + i * 1000);
        }
        expect(log.getEntries()).toHaveLength(10);
        // The newest entries are the ones kept.
        expect(log.getEntries().at(-1).risk).toBeCloseTo(49 / 50, 5);
    });

    it('defaults to a bounded size', () => {
        const log = new IncidentLog();
        expect(log.maxEntries).toBe(MAX_ENTRIES);
    });

    it('snapshots only the recent window', () => {
        const log = new IncidentLog();
        log.record(EVENT.READING, { risk: 0.1 }, T0);
        log.record(EVENT.READING, { risk: 0.9 }, T0 + 120_000);

        const recent = log.snapshot(60_000, T0 + 120_000);
        expect(recent).toHaveLength(1);
        expect(recent[0].risk).toBe(0.9);
    });

    it('clears', () => {
        const log = new IncidentLog();
        log.record(EVENT.READING, { risk: 0.5 }, T0);
        log.clear();
        expect(log.getEntries()).toHaveLength(0);
    });
});

describe('summariseSnapshot', () => {
    const entries = [
        { t: T0, type: EVENT.PROTECTION_ON },
        { t: T0 + 1000, type: EVENT.READING, risk: 0.2, readings: { gesture: 0, stress: 0.2 }, active: ['stress'] },
        { t: T0 + 2000, type: EVENT.READING, risk: 0.9, readings: { gesture: 1, stress: 0.6 }, active: ['gesture', 'stress'] },
        { t: T0 + 3000, type: EVENT.COUNTDOWN_STARTED, reason: 'You held the distress hand signal' },
    ];

    it('finds the peak reading', () => {
        const summary = summariseSnapshot(entries);
        expect(summary.peakRisk).toBe(0.9);
        expect(summary.peakReadings).toEqual({ gesture: 1, stress: 0.6 });
    });

    it('collects every sensor that was active', () => {
        expect(summariseSnapshot(entries).activeSensors.sort()).toEqual(['gesture', 'stress']);
    });

    it('separates moments from periodic readings', () => {
        // Sixty rows of near-identical numbers is not an explanation.
        const summary = summariseSnapshot(entries);
        expect(summary.moments).toHaveLength(2);
        expect(summary.moments.every((m) => m.type !== EVENT.READING)).toBe(true);
    });

    it('reports the span covered', () => {
        expect(summariseSnapshot(entries).durationMs).toBe(3000);
    });

    it('handles an empty log', () => {
        const summary = summariseSnapshot([]);
        expect(summary.peakRisk).toBe(0);
        expect(summary.moments).toEqual([]);
    });
});

describe('summariseTrigger', () => {
    it('names a held hand signal plainly', () => {
        const entries = [
            { t: T0, type: EVENT.READING, risk: 0.9, readings: { gesture: 1, stress: 0.1 }, active: ['gesture'] },
        ];
        expect(summariseTrigger(entries)).toContain('distress hand signal held');
    });

    it('reports percentages for the graded sensors', () => {
        const entries = [
            { t: T0, type: EVENT.READING, risk: 0.8, readings: { stress: 0.72, motion: 0.65 }, active: ['stress', 'motion'] },
        ];
        const summary = summariseTrigger(entries);
        expect(summary).toContain('voice tension 72%');
        expect(summary).toContain('movement 65%');
    });

    it('falls back to the reason when there are no readings', () => {
        expect(summariseTrigger([], 'Manual alert')).toBe('Manual alert');
    });

    it('omits a hand signal that was never held', () => {
        const entries = [
            { t: T0, type: EVENT.READING, risk: 0.4, readings: { gesture: 0, stress: 0.4 }, active: ['gesture', 'stress'] },
        ];
        expect(summariseTrigger(entries)).not.toContain('hand signal');
    });
});

describe('describeMoment', () => {
    it('describes each event in plain language', () => {
        expect(describeMoment({ type: EVENT.PROTECTION_ON })).toBe('Protection turned on');
        expect(describeMoment({ type: EVENT.COUNTDOWN_CANCELLED })).toBe('You stopped the alert');
        expect(describeMoment({ type: EVENT.SENSOR_ON, sensor: 'gesture' })).toBe('hand signal enabled');
        expect(describeMoment({ type: EVENT.SUSTAIN_STARTED, risk: 0.82 })).toContain('82%');
    });

    it('includes the escalation reason when there is one', () => {
        const line = describeMoment({ type: EVENT.COUNTDOWN_STARTED, reason: 'Several signs at once' });
        expect(line).toContain('Several signs at once');
    });
});

describe('formatRisk', () => {
    it('renders a percentage', () => {
        expect(formatRisk(0.826)).toBe('83%');
        expect(formatRisk(undefined)).toBe('0%');
    });
});
