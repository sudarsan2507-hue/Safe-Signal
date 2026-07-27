/**
 * Stress Inference Module (rule-based)
 * Turns a short-time feature matrix into a 0–1 vocal stress estimate.
 *
 * Scoring is deviation-based: what matters is how far the current speech sits
 * from *this speaker's* calibrated baseline, not absolute pitch or loudness.
 * That avoids penalising naturally loud or high-pitched voices.
 *
 * Each feature contributes only when it is actually available, and the weights
 * are renormalised over whatever is present. Without that, a feature that
 * silently returns zero would quietly drag every score toward zero while
 * still looking like a working five-feature model.
 */

import { calculateStats } from './featureExtractor.js';

/** Mean RMS below which a window is treated as silence rather than speech. */
export const VAD_MIN_RMS = 0.01;

/** Ambient floor above which RMS is considered unreliable. */
const NOISE_HIGH_THRESHOLD = 0.05;

/** Maximum stress increase permitted per processing step. */
export const SPIKE_LIMIT = 0.15;

/** Minimum autocorrelation confidence for a frame to count as voiced. */
const MIN_VOICED_CONFIDENCE = 0.45;

const BASE_WEIGHTS = {
    pitch: 0.30,
    rms: 0.25,
    mfcc: 0.20,
    centroid: 0.15,
    zcr: 0.10,
};

/**
 * Compute a raw, unsmoothed stress score. Pure — no module state.
 *
 * @param {Object} featureMatrix - from buildFeatureMatrix
 * @param {Object|null} baseline - { pitch, rms, centroid } from calibration
 * @param {number} noiseFloor - ambient RMS estimate
 * @returns {{ score: number, components: Object, usedBaseline: boolean }}
 */
export const computeRawStressScore = (featureMatrix, baseline = null, noiseFloor = 0) => {
    const empty = { score: 0, components: {}, usedBaseline: false };

    if (!featureMatrix || !featureMatrix.rms || featureMatrix.rms.length === 0) {
        return empty;
    }

    const rmsStats = calculateStats(featureMatrix.rms);
    if (rmsStats.mean < VAD_MIN_RMS) return empty;

    // Only frames with a confident pitch estimate should shape the pitch score.
    const voicedPitch = [];
    for (let i = 0; i < featureMatrix.pitch.length; i++) {
        const conf = featureMatrix.pitchConfidence?.[i] ?? 1;
        if (featureMatrix.pitch[i] > 0 && conf >= MIN_VOICED_CONFIDENCE) {
            voicedPitch.push(featureMatrix.pitch[i]);
        }
    }

    const pitchStats = calculateStats(voicedPitch);
    const zcrStats = calculateStats(featureMatrix.zcr);
    const centroidStats = calculateStats(featureMatrix.spectralCentroid);
    const mfccVariance = calculateMFCCTemporalVariance(featureMatrix.mfcc);

    const components = {};
    const weights = {};

    // ── Pitch ──────────────────────────────────────────────────────────────
    if (voicedPitch.length > 0) {
        if (baseline?.pitch > 0) {
            components.pitch = Math.min(
                Math.abs(pitchStats.mean - baseline.pitch) / baseline.pitch,
                1,
            );
        } else {
            // No baseline: fall back to pitch instability within the window.
            components.pitch = Math.min(pitchStats.std / 50, 1);
        }
        weights.pitch = BASE_WEIGHTS.pitch;
    }

    // ── Energy ─────────────────────────────────────────────────────────────
    if (baseline?.rms > 0) {
        components.rms = Math.min(Math.abs(rmsStats.mean - baseline.rms) / baseline.rms, 1);
    } else {
        components.rms = Math.min(rmsStats.variance / 0.05, 1);
    }
    weights.rms = BASE_WEIGHTS.rms;

    // ── MFCC temporal variability ──────────────────────────────────────────
    if (featureMatrix.mfcc.length > 1) {
        components.mfcc = Math.min(mfccVariance / 10, 1);
        weights.mfcc = BASE_WEIGHTS.mfcc;
    }

    // ── Spectral centroid ──────────────────────────────────────────────────
    if (centroidStats.mean > 0) {
        if (baseline?.centroid > 0) {
            components.centroid = Math.min(
                Math.abs(centroidStats.mean - baseline.centroid) / baseline.centroid,
                1,
            );
        } else {
            components.centroid = Math.min(centroidStats.mean / 3000, 1);
        }
        weights.centroid = BASE_WEIGHTS.centroid;
    }

    // ── Zero crossing rate ─────────────────────────────────────────────────
    components.zcr = Math.min(zcrStats.variance / 0.01, 1);
    weights.zcr = BASE_WEIGHTS.zcr;

    // In a noisy room, absolute energy says more about the room than the
    // speaker, so shift some of its weight onto pitch deviation.
    if (noiseFloor > NOISE_HIGH_THRESHOLD && weights.rms && weights.pitch) {
        const shift = weights.rms * 0.2;
        weights.rms -= shift;
        weights.pitch += shift;
    }

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return empty;

    let score = 0;
    for (const key of Object.keys(weights)) {
        score += components[key] * (weights[key] / totalWeight);
    }

    return {
        score: Math.max(0, Math.min(1, score)),
        components,
        usedBaseline: Boolean(baseline?.pitch > 0 || baseline?.rms > 0),
    };
};

/**
 * Stateful estimator wrapping the pure scorer with a rise-rate limiter.
 * Instance-scoped so two pipelines (or two tests) cannot corrupt each other.
 */
export class StressEstimator {
    constructor(spikeLimit = SPIKE_LIMIT) {
        this.spikeLimit = spikeLimit;
        this.previousScore = 0;
        this.lastComponents = {};
    }

    /**
     * @param {Object} featureMatrix
     * @param {Object|null} baseline
     * @param {number} noiseFloor
     * @returns {number} Rate-limited stress score
     */
    update(featureMatrix, baseline = null, noiseFloor = 0) {
        const { score, components } = computeRawStressScore(featureMatrix, baseline, noiseFloor);
        this.lastComponents = components;
        return this.applyLimit(score);
    }

    /**
     * Cap how fast stress may rise. Falling is unrestricted, so the app calms
     * down immediately once someone does.
     * @param {number} newScore
     * @returns {number}
     */
    applyLimit(newScore) {
        const delta = newScore - this.previousScore;
        const limited = delta > this.spikeLimit ? this.previousScore + this.spikeLimit : newScore;
        this.previousScore = limited;
        return limited;
    }

    reset() {
        this.previousScore = 0;
        this.lastComponents = {};
    }

    getComponents() {
        return this.lastComponents;
    }
}

/**
 * Mean frame-to-frame change in MFCC space — distressed speech is less steady
 * than calm speech.
 * @param {number[][]} mfccMatrix
 * @returns {number}
 */
export const calculateMFCCTemporalVariance = (mfccMatrix) => {
    if (!mfccMatrix || mfccMatrix.length < 2) return 0;

    const numCoeffs = mfccMatrix[0].length;
    if (numCoeffs === 0) return 0;

    let totalDifference = 0;
    for (let t = 1; t < mfccMatrix.length; t++) {
        for (let c = 0; c < numCoeffs; c++) {
            const diff = mfccMatrix[t][c] - mfccMatrix[t - 1][c];
            totalDifference += diff * diff;
        }
    }

    return Math.sqrt(totalDifference / (mfccMatrix.length - 1) / numCoeffs);
};

/**
 * @param {number} score
 * @returns {'calm'|'elevated'|'high'}
 */
export const getStressLevel = (score) => {
    if (score < 0.3) return 'calm';
    if (score < 0.75) return 'elevated';
    return 'high';
};

/**
 * Plain-language description of a stress score.
 * @param {number} score
 * @returns {string}
 */
export const describeStress = (score) => {
    const level = getStressLevel(score);
    if (level === 'calm') return 'Your voice sounds steady';
    if (level === 'elevated') return 'Your voice sounds a little tense';
    return 'Your voice sounds strained';
};
