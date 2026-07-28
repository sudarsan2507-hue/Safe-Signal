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

import {
    calculateStats,
    computePitchVariability,
    computeEnergyVariability,
} from './featureExtractor.js';

/** Mean RMS below which a window is treated as silence rather than speech. */
export const VAD_MIN_RMS = 0.01;

/** Ambient floor above which RMS is considered unreliable. */
const NOISE_HIGH_THRESHOLD = 0.05;

/** Maximum stress increase permitted per processing step. */
export const SPIKE_LIMIT = 0.15;

/** Minimum autocorrelation confidence for a frame to count as voiced. */
const MIN_VOICED_CONFIDENCE = 0.45;

/**
 * Feature weights.
 *
 * An earlier revision also weighted MFCC temporal variance (0.20) and ZCR
 * variance (0.10). Measured against synthetic calm and distressed speech, those
 * two contributed almost nothing — roughly 0.05 and 0.00 respectively — while
 * holding 30% of the weight, which diluted the features that do discriminate.
 * They are replaced here by jitter and shimmer, the standard acoustic measures
 * of vocal instability.
 */
const BASE_WEIGHTS = {
    pitch: 0.30,
    rms: 0.22,
    centroid: 0.28,
    pitchVariability: 0.12,
    energyVariability: 0.08,
};

/**
 * Deviation, relative to baseline, at which a feature counts as fully elevated.
 * Expressed as a fraction of the baseline value.
 *
 * These are set wide enough that ordinary animated speech does not saturate
 * them. Tighter values (0.5 / 1.0 / 0.8) put a lively but untroubled voice at
 * 0.38 — above the "elevated" line — while leaving genuine distress and severe
 * distress almost indistinguishable, because all three features had already
 * pinned at 1.0 by then.
 */
const FULL_SCALE = {
    pitch: 0.9,     // ~90% above your normal pitch
    rms: 2.2,       // >3x your normal speaking energy
    centroid: 1.8,  // markedly brighter and harsher than normal
};

/**
 * Variability levels treated as fully elevated, at ~32 ms frame resolution.
 * Both are small numbers; setting them by intuition rather than measurement is
 * how the previous ZCR term ended up contributing a flat zero while holding 10%
 * of the weight.
 */
const PITCH_VARIABILITY_FULL_SCALE = 0.006;
const ENERGY_VARIABILITY_FULL_SCALE = 0.012;

/**
 * Score how far a value sits *above* its baseline, ignoring drops.
 *
 * Distress raises pitch, loudness and spectral brightness. Scoring the absolute
 * deviation instead meant speaking more softly or lower than usual registered as
 * stress — measured at 0.15 for quiet calm speech, which is simply wrong.
 *
 * @param {number} value
 * @param {number} baseline
 * @param {number} fullScaleFraction
 * @returns {number} 0-1
 */
const scoreUpwardDeviation = (value, baseline, fullScaleFraction) => {
    if (!(baseline > 0)) return 0;
    const rise = (value - baseline) / baseline;
    return clamp01(rise / fullScaleFraction);
};

/**
 * @param {number} value
 * @returns {number}
 */
const clamp01 = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(value, 0), 1);
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
    const centroidStats = calculateStats(featureMatrix.spectralCentroid);

    const components = {};
    const weights = {};

    // ── Pitch: raised relative to your own normal ──────────────────────────
    if (voicedPitch.length > 0) {
        if (baseline?.pitch > 0) {
            components.pitch = scoreUpwardDeviation(pitchStats.mean, baseline.pitch, FULL_SCALE.pitch);
        } else {
            // No baseline yet — fall back to instability within the window.
            components.pitch = clamp01(pitchStats.std / 40);
        }
        weights.pitch = BASE_WEIGHTS.pitch;
    }

    // ── Energy: louder than your own normal ────────────────────────────────
    if (baseline?.rms > 0) {
        components.rms = scoreUpwardDeviation(rmsStats.mean, baseline.rms, FULL_SCALE.rms);
    } else {
        components.rms = clamp01(rmsStats.variance / 0.05);
    }
    weights.rms = BASE_WEIGHTS.rms;

    // ── Unsteadiness ───────────────────────────────────────────────────────
    // These need no baseline, which is what makes them useful before
    // calibration completes. They carry less weight than the elevation
    // features because frame-level resolution blunts them.
    if (voicedPitch.length >= 3) {
        components.pitchVariability = clamp01(
            computePitchVariability(featureMatrix.pitch) / PITCH_VARIABILITY_FULL_SCALE,
        );
        weights.pitchVariability = BASE_WEIGHTS.pitchVariability;
    }

    if (featureMatrix.rms.length >= 3) {
        components.energyVariability = clamp01(
            computeEnergyVariability(featureMatrix.rms) / ENERGY_VARIABILITY_FULL_SCALE,
        );
        weights.energyVariability = BASE_WEIGHTS.energyVariability;
    }

    // ── Spectral brightness: harsher, tenser timbre ────────────────────────
    if (centroidStats.mean > 0) {
        if (baseline?.centroid > 0) {
            components.centroid = scoreUpwardDeviation(
                centroidStats.mean,
                baseline.centroid,
                FULL_SCALE.centroid,
            );
        } else {
            components.centroid = clamp01(centroidStats.mean / 3000);
        }
        weights.centroid = BASE_WEIGHTS.centroid;
    }

    // In a noisy room, absolute energy says more about the room than the
    // speaker, so shift some of its weight onto pitch.
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

/* calculateMFCCTemporalVariance was removed here. Measured against synthetic
   calm and distressed speech it contributed roughly 0.05 either way while
   holding 20% of the scoring weight. MFCCs are still extracted for the
   visualiser, but they no longer influence the score. */

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
