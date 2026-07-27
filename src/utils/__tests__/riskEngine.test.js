import { describe, it, expect } from 'vitest';
import {
    calculateRisk,
    evaluateCorroboration,
    RiskTracker,
    getRiskLevel,
    RISK_THRESHOLD,
    SUSTAIN_DURATION_MS,
} from '../riskEngine.js';

const ALL = { gesture: true, stress: true, motion: true };

describe('calculateRisk', () => {
    it('returns zero when no sensor is available', () => {
        const result = calculateRisk(
            { gesture: 1, stress: 1, motion: 1 },
            { gesture: false, stress: false, motion: false },
        );
        expect(result.score).toBe(0);
        expect(result.activeSensors).toEqual([]);
        expect(result.coverage).toBe(0);
    });

    it('reaches the threshold with only the camera available', () => {
        // The regression that made auto-detection impossible: with fixed
        // weights a camera-only device capped out at 0.5, below the 0.75
        // threshold, so no alert could ever fire.
        const result = calculateRisk(
            { gesture: 1, stress: 0, motion: 0 },
            { gesture: true, stress: false, motion: false },
        );
        expect(result.score).toBe(1);
        expect(result.score).toBeGreaterThanOrEqual(RISK_THRESHOLD);
    });

    it('reaches the threshold with only the microphone available', () => {
        const result = calculateRisk(
            { gesture: 0, stress: 0.9, motion: 0 },
            { gesture: false, stress: true, motion: false },
        );
        expect(result.score).toBeCloseTo(0.9, 5);
    });

    it('weights sensors proportionally when all are present', () => {
        const result = calculateRisk({ gesture: 1, stress: 1, motion: 1 }, ALL);
        expect(result.score).toBeCloseTo(1, 5);
        expect(result.contributions.gesture.weight).toBeCloseTo(0.5, 5);
        expect(result.contributions.stress.weight).toBeCloseTo(0.3, 5);
        expect(result.contributions.motion.weight).toBeCloseTo(0.2, 5);
    });

    it('reports partial coverage honestly', () => {
        const result = calculateRisk(
            { gesture: 1, stress: 0, motion: 0 },
            { gesture: true, stress: false, motion: false },
        );
        expect(result.coverage).toBeCloseTo(0.5, 5);
    });

    it('clamps out-of-range and non-finite readings', () => {
        const result = calculateRisk(
            { gesture: 5, stress: -2, motion: NaN },
            ALL,
        );
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
        expect(result.contributions.gesture.value).toBe(1);
        expect(result.contributions.stress.value).toBe(0);
        expect(result.contributions.motion.value).toBe(0);
    });
});

describe('evaluateCorroboration', () => {
    it('accepts a confirmed hand signal on its own', () => {
        const result = evaluateCorroboration({ gesture: 1, stress: 0, motion: 0 }, ALL);
        expect(result.corroborated).toBe(true);
    });

    it('rejects a single noisy sensor', () => {
        const result = evaluateCorroboration({ gesture: 0, stress: 0.95, motion: 0 }, ALL);
        expect(result.corroborated).toBe(false);
    });

    it('accepts two independent sensors agreeing', () => {
        const result = evaluateCorroboration({ gesture: 0, stress: 0.7, motion: 0.7 }, ALL);
        expect(result.corroborated).toBe(true);
        expect(result.concerned).toEqual(['stress', 'motion']);
    });

    it('ignores readings from unavailable sensors', () => {
        const result = evaluateCorroboration(
            { gesture: 1, stress: 0.9, motion: 0.9 },
            { gesture: false, stress: false, motion: true },
        );
        expect(result.corroborated).toBe(false);
    });
});

describe('RiskTracker', () => {
    const critical = { gesture: 1, stress: 0, motion: 0 };
    const availability = { gesture: true, stress: false, motion: false };

    it('does not escalate before the sustain window elapses', () => {
        const tracker = new RiskTracker();
        const t0 = 1_000_000;

        expect(tracker.update(critical, availability, t0).shouldEscalate).toBe(false);
        expect(tracker.update(critical, availability, t0 + 4999).shouldEscalate).toBe(false);
    });

    it('escalates once risk has been sustained', () => {
        const tracker = new RiskTracker();
        const t0 = 1_000_000;

        tracker.update(critical, availability, t0);
        const result = tracker.update(critical, availability, t0 + SUSTAIN_DURATION_MS);
        expect(result.shouldEscalate).toBe(true);
    });

    it('escalates only once per sustained episode', () => {
        const tracker = new RiskTracker();
        const t0 = 1_000_000;

        tracker.update(critical, availability, t0);
        tracker.update(critical, availability, t0 + SUSTAIN_DURATION_MS);
        const again = tracker.update(critical, availability, t0 + SUSTAIN_DURATION_MS + 1000);
        expect(again.shouldEscalate).toBe(false);
    });

    it('re-arms after risk drops and rises again', () => {
        // The original bug: the sustain timeout was cleared without clearing
        // its ref, so escalation could never be armed a second time.
        const tracker = new RiskTracker();
        const t0 = 1_000_000;
        const calm = { gesture: 0, stress: 0, motion: 0 };

        tracker.update(critical, availability, t0);
        expect(tracker.update(critical, availability, t0 + SUSTAIN_DURATION_MS).shouldEscalate).toBe(true);

        tracker.update(calm, availability, t0 + SUSTAIN_DURATION_MS + 1000);

        const restart = t0 + 20_000;
        tracker.update(critical, availability, restart);
        expect(tracker.update(critical, availability, restart + SUSTAIN_DURATION_MS).shouldEscalate).toBe(true);
    });

    it('resets sustain progress when risk falls below threshold', () => {
        const tracker = new RiskTracker();
        const t0 = 1_000_000;

        tracker.update(critical, availability, t0);
        tracker.update(critical, availability, t0 + 3000);
        const dropped = tracker.update({ gesture: 0 }, availability, t0 + 3500);

        expect(dropped.sustainedMs).toBe(0);
        expect(dropped.sustainProgress).toBe(0);
    });

    it('never escalates on a high but uncorroborated score', () => {
        const tracker = new RiskTracker();
        const micOnly = { gesture: false, stress: true, motion: false };
        const t0 = 1_000_000;

        tracker.update({ stress: 0.99 }, micOnly, t0);
        const later = tracker.update({ stress: 0.99 }, micOnly, t0 + SUSTAIN_DURATION_MS * 3);
        expect(later.score).toBeGreaterThan(RISK_THRESHOLD);
        expect(later.shouldEscalate).toBe(false);
    });

    it('reset clears sustain state', () => {
        const tracker = new RiskTracker();
        const t0 = 1_000_000;

        tracker.update(critical, availability, t0);
        tracker.reset();
        expect(tracker.update(critical, availability, t0 + SUSTAIN_DURATION_MS).sustainedMs).toBe(0);
    });
});

describe('getRiskLevel', () => {
    it('maps scores to levels at the documented boundaries', () => {
        expect(getRiskLevel(0)).toBe('safe');
        expect(getRiskLevel(0.29)).toBe('safe');
        expect(getRiskLevel(0.3)).toBe('elevated');
        expect(getRiskLevel(0.74)).toBe('elevated');
        expect(getRiskLevel(0.75)).toBe('critical');
        expect(getRiskLevel(1)).toBe('critical');
    });
});
