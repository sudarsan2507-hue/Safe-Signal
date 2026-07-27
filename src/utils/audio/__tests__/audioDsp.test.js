import { describe, it, expect } from 'vitest';
import {
    createAudioProcessor,
    computeRMS,
    makeHannWindow,
    FRAME_SIZE,
    HOP_SIZE,
} from '../audioProcessor.js';
import {
    extractMFCC,
    extractPitchDetailed,
    extractSpectralCentroid,
    extractZCR,
    calculateStats,
    buildFeatureMatrix,
} from '../featureExtractor.js';
import {
    computeRawStressScore,
    StressEstimator,
    SPIKE_LIMIT,
    calculateMFCCTemporalVariance,
} from '../stressInference.js';

const SR = 16000;

/**
 * Synthesize a voiced signal with harmonics.
 * @param {number} f0
 * @param {number} seconds
 * @param {number} amplitude
 * @returns {Float32Array}
 */
const voiced = (f0, seconds = 1.5, amplitude = 0.3) => {
    const out = new Float32Array(Math.floor(SR * seconds));
    for (let i = 0; i < out.length; i++) {
        const t = i / SR;
        out[i] = amplitude * (
            Math.sin(2 * Math.PI * f0 * t) +
            0.5 * Math.sin(2 * Math.PI * f0 * 2 * t) +
            0.25 * Math.sin(2 * Math.PI * f0 * 3 * t)
        );
    }
    return out;
};

describe('framing', () => {
    it('produces power-of-two frames', () => {
        // Meyda throws on non-power-of-two buffers. The original 25 ms framing
        // gave 400 samples, so every MFCC and centroid silently came back zero.
        const proc = createAudioProcessor(SR);
        proc.addToRollingBuffer(voiced(150));
        const frames = proc.splitIntoFrames(proc.getRollingWindow(1.5));

        expect(frames.length).toBeGreaterThan(0);
        for (const frame of frames) {
            expect(frame.length).toBe(FRAME_SIZE);
            expect(frame.length & (frame.length - 1)).toBe(0);
        }
    });

    it('overlaps frames by the hop size', () => {
        const proc = createAudioProcessor(SR);
        const samples = new Float32Array(FRAME_SIZE * 4).fill(0.1);
        proc.addToRollingBuffer(samples);
        const frames = proc.splitIntoFrames(samples);
        const expected = Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1;
        expect(frames.length).toBe(expected);
    });

    it('returns rolling-window samples in chronological order', () => {
        const proc = createAudioProcessor(SR);
        const ramp = new Float32Array(1000);
        for (let i = 0; i < ramp.length; i++) ramp[i] = i / 1000;
        proc.addToRollingBuffer(ramp);

        const window = proc.getRollingWindow(1000 / SR);
        expect(window[window.length - 1]).toBeGreaterThan(window[0]);
    });

    it('wraps the ring buffer without losing ordering', () => {
        const proc = createAudioProcessor(100); // 2 s => 200 samples
        const first = new Float32Array(150).fill(1);
        const second = new Float32Array(150).fill(2);
        proc.addToRollingBuffer(first);
        proc.addToRollingBuffer(second);

        const window = proc.getRollingWindow(1); // last 100 samples
        expect(Array.from(window).every((v) => v === 2)).toBe(true);
    });
});

describe('feature extraction', () => {
    const proc = createAudioProcessor(SR);
    proc.addToRollingBuffer(voiced(150));
    const frames = proc.splitIntoFrames(proc.getRollingWindow(1.5));
    const frame = frames[10];

    it('produces non-zero MFCCs', () => {
        const mfcc = extractMFCC(frame, SR);
        expect(mfcc.length).toBe(13);
        expect(Array.from(mfcc).some((v) => v !== 0)).toBe(true);
    });

    it('reports the spectral centroid in hertz, not bin index', () => {
        const centroid = extractSpectralCentroid(frame, SR);
        expect(centroid).toBeGreaterThan(50);
        expect(centroid).toBeLessThan(SR / 2);
    });

    it('estimates a known fundamental accurately', () => {
        const result = extractPitchDetailed(frame, SR);
        expect(result.hz).toBeGreaterThan(140);
        expect(result.hz).toBeLessThan(160);
        expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('distinguishes low from high fundamentals', () => {
        // Unnormalized autocorrelation is biased toward short lags and would
        // collapse both of these toward the top of the search range.
        const lowProc = createAudioProcessor(SR);
        lowProc.addToRollingBuffer(voiced(100));
        const low = extractPitchDetailed(lowProc.splitIntoFrames(lowProc.getRollingWindow(1))[5], SR);

        const highProc = createAudioProcessor(SR);
        highProc.addToRollingBuffer(voiced(250));
        const high = extractPitchDetailed(highProc.splitIntoFrames(highProc.getRollingWindow(1))[5], SR);

        expect(low.hz).toBeLessThan(high.hz);
        expect(low.hz).toBeGreaterThan(90);
        expect(high.hz).toBeLessThan(270);
    });

    it('reports silence as unvoiced', () => {
        const silence = new Float32Array(FRAME_SIZE);
        expect(extractPitchDetailed(silence, SR).hz).toBe(0);
    });

    it('does not report confident pitch for noise', () => {
        const noise = new Float32Array(FRAME_SIZE);
        for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 0.2;
        const result = extractPitchDetailed(noise, SR);
        expect(result.confidence).toBeLessThan(0.45);
        expect(result.hz).toBe(0);
    });

    it('computes zero crossing rate between 0 and 1', () => {
        const zcr = extractZCR(frame);
        expect(zcr).toBeGreaterThanOrEqual(0);
        expect(zcr).toBeLessThanOrEqual(1);
    });

    it('builds a feature matrix with aligned rows', () => {
        const matrix = buildFeatureMatrix(frames.slice(0, 5), SR);
        expect(matrix.mfcc).toHaveLength(5);
        expect(matrix.pitch).toHaveLength(5);
        expect(matrix.rms).toHaveLength(5);
        expect(matrix.pitchConfidence).toHaveLength(5);
    });
});

describe('calculateStats', () => {
    it('handles an empty array', () => {
        expect(calculateStats([])).toEqual({ mean: 0, std: 0, variance: 0, min: 0, max: 0 });
    });

    it('computes mean, variance and range', () => {
        const stats = calculateStats([2, 4, 6]);
        expect(stats.mean).toBeCloseTo(4, 10);
        expect(stats.variance).toBeCloseTo(8 / 3, 10);
        expect(stats.min).toBe(2);
        expect(stats.max).toBe(6);
    });

    it('survives arrays far larger than the call-stack spread limit', () => {
        const big = new Array(200_000).fill(1);
        expect(() => calculateStats(big)).not.toThrow();
        expect(calculateStats(big).mean).toBe(1);
    });
});

describe('helpers', () => {
    it('computes RMS', () => {
        expect(computeRMS(new Float32Array([3, 4]))).toBeCloseTo(Math.sqrt(12.5), 6);
        expect(computeRMS(new Float32Array(0))).toBe(0);
    });

    it('builds a Hann window tapering to zero at the start', () => {
        const w = makeHannWindow(8);
        expect(w[0]).toBeCloseTo(0, 6);
        expect(w[4]).toBeCloseTo(1, 6);
    });
});

describe('stress inference', () => {
    const makeMatrix = (overrides = {}) => ({
        mfcc: [new Array(13).fill(1), new Array(13).fill(2)],
        pitch: [150, 152],
        pitchConfidence: [0.8, 0.8],
        rms: [0.2, 0.21],
        zcr: [0.1, 0.11],
        spectralCentroid: [800, 820],
        ...overrides,
    });

    it('returns zero for silence below the voice threshold', () => {
        const result = computeRawStressScore(makeMatrix({ rms: [0.001, 0.001] }));
        expect(result.score).toBe(0);
    });

    it('scores near zero when speech matches the baseline', () => {
        const baseline = { pitch: 151, rms: 0.205, centroid: 810 };
        const result = computeRawStressScore(makeMatrix(), baseline);
        expect(result.usedBaseline).toBe(true);
        expect(result.score).toBeLessThan(0.3);
    });

    it('scores higher when speech deviates from the baseline', () => {
        const baseline = { pitch: 151, rms: 0.205, centroid: 810 };
        const calm = computeRawStressScore(makeMatrix(), baseline).score;
        const strained = computeRawStressScore(
            makeMatrix({ pitch: [300, 310], rms: [0.6, 0.62], spectralCentroid: [2400, 2500] }),
            baseline,
        ).score;
        expect(strained).toBeGreaterThan(calm);
    });

    it('renormalises weights when a feature is unavailable', () => {
        // Without renormalisation a zeroed feature silently drags the score
        // down while the model still looks fully populated.
        const result = computeRawStressScore(makeMatrix({ spectralCentroid: [0, 0] }));
        expect(result.components.centroid).toBeUndefined();
        expect(result.score).toBeGreaterThan(0);
        expect(result.score).toBeLessThanOrEqual(1);
    });

    it('ignores pitch frames below the voicing confidence threshold', () => {
        const result = computeRawStressScore(
            makeMatrix({ pitchConfidence: [0.1, 0.1] }),
        );
        expect(result.components.pitch).toBeUndefined();
    });

    it('always yields a score within range', () => {
        const result = computeRawStressScore(
            makeMatrix({ pitch: [400, 400], rms: [1, 1], spectralCentroid: [7000, 7000] }),
            { pitch: 100, rms: 0.01, centroid: 300 },
        );
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
    });
});

describe('StressEstimator', () => {
    it('limits how fast the score may rise', () => {
        const estimator = new StressEstimator();
        expect(estimator.applyLimit(1)).toBeCloseTo(SPIKE_LIMIT, 6);
        expect(estimator.applyLimit(1)).toBeCloseTo(SPIKE_LIMIT * 2, 6);
    });

    it('allows the score to fall immediately', () => {
        const estimator = new StressEstimator();
        estimator.applyLimit(0.15);
        expect(estimator.applyLimit(0)).toBe(0);
    });

    it('keeps state per instance', () => {
        // Module-level state previously leaked between pipelines and tests.
        const a = new StressEstimator();
        const b = new StressEstimator();
        a.applyLimit(1);
        expect(b.applyLimit(1)).toBeCloseTo(SPIKE_LIMIT, 6);
    });

    it('resets cleanly', () => {
        const estimator = new StressEstimator();
        estimator.applyLimit(0.15);
        estimator.reset();
        expect(estimator.previousScore).toBe(0);
    });
});

describe('calculateMFCCTemporalVariance', () => {
    it('is zero for a steady signal', () => {
        const steady = [new Array(13).fill(3), new Array(13).fill(3)];
        expect(calculateMFCCTemporalVariance(steady)).toBe(0);
    });

    it('grows with frame-to-frame change', () => {
        const steady = [new Array(13).fill(3), new Array(13).fill(3)];
        const jumpy = [new Array(13).fill(0), new Array(13).fill(10)];
        expect(calculateMFCCTemporalVariance(jumpy)).toBeGreaterThan(
            calculateMFCCTemporalVariance(steady),
        );
    });

    it('handles degenerate input', () => {
        expect(calculateMFCCTemporalVariance([])).toBe(0);
        expect(calculateMFCCTemporalVariance(null)).toBe(0);
    });
});
