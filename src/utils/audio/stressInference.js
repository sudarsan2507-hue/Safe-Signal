/**
 * Stress Inference Module (Rule-Based for Hackathon)
 * Computes stress score from extracted features using deviation-based logic.
 * Designed to be replaced with CNN+BiLSTM model later.
 *
 * Enhancements (v2):
 *  - Deviation-based scoring (relative to calibration baseline)
 *  - VAD confidence gate (skip computation on silence/noise)
 *  - Spike limiter (max +0.15 per 500ms step)
 *  - Adaptive noise compensation (reduce RMS weight in noisy environments)
 */

import { calculateStats } from './featureExtractor.js';

// ─── Module-level state ────────────────────────────────────────────────────

/**
 * Previous stress score — used by the spike limiter.
 * Reset via resetStressState() when the pipeline stops.
 */
let previousStressScore = 0;

// ─── Constants ─────────────────────────────────────────────────────────────

/** Minimum RMS for a frame to be considered speech (VAD gate) */
const VAD_MIN_RMS = 0.01;

/** Ambient noise floor above which we apply noise compensation */
const NOISE_HIGH_THRESHOLD = 0.05;

/** Maximum allowed stress increase per 500ms processing step */
const SPIKE_LIMIT = 0.15;

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Deviation-based stress inference from feature matrix.
 *
 * @param {Object} featureMatrix - Output from buildFeatureMatrix
 * @param {Object|null} baseline - Calibration baseline { pitch, rms, centroid }
 * @param {number} noiseFloor - Estimated ambient RMS (0 if unknown)
 * @returns {number} Stress probability (0-1)
 */
export const computeStressScore = (featureMatrix, baseline = null, noiseFloor = 0) => {
    if (!featureMatrix || featureMatrix.pitch.length === 0) {
        return _applySpikeLimiter(0);
    }

    // ── 1. VAD Confidence Gate ─────────────────────────────────────────────
    // If mean RMS is too low, this is silence or background noise — skip.
    const rmsStats = calculateStats(featureMatrix.rms);
    if (rmsStats.mean < VAD_MIN_RMS) {
        return _applySpikeLimiter(0);
    }

    // ── 2. Feature Statistics ──────────────────────────────────────────────
    const voicedPitch = featureMatrix.pitch.filter(p => p > 0);
    const pitchStats = calculateStats(voicedPitch.length > 0 ? voicedPitch : [0]);
    const zcrStats = calculateStats(featureMatrix.zcr);
    const centroidStats = calculateStats(featureMatrix.spectralCentroid);
    const mfccVariance = _calculateMFCCTemporalVariance(featureMatrix.mfcc);

    // ── 3. Deviation-Based Scoring ─────────────────────────────────────────
    let pitchScore, rmsScore, centroidScore;

    if (baseline && baseline.pitch > 0 && baseline.rms > 0 && baseline.centroid > 0) {
        // Normalize deviations relative to baseline (avoids bias for loud/high-pitched speakers)
        const pitchDev = Math.abs(pitchStats.mean - baseline.pitch) / Math.max(baseline.pitch, 1);
        const rmsDev = Math.abs(rmsStats.mean - baseline.rms) / Math.max(baseline.rms, 0.001);
        const centroidDev = Math.abs(centroidStats.mean - baseline.centroid) / Math.max(baseline.centroid, 1);

        // Cap each normalized deviation at 1.0
        pitchScore = Math.min(pitchDev, 1);
        rmsScore = Math.min(rmsDev, 1);
        centroidScore = Math.min(centroidDev, 1);
    } else {
        // Fallback to absolute thresholds when no baseline is available
        pitchScore = Math.min(pitchStats.std / 50, 1);
        rmsScore = Math.min(rmsStats.variance / 0.05, 1);
        centroidScore = Math.min(centroidStats.mean / 3000, 1);
    }

    // MFCC temporal variance score (unchanged — already relative)
    const mfccScore = Math.min(mfccVariance / 10, 1);

    // ZCR variance score
    const zcrScore = Math.min(zcrStats.variance / 0.01, 1);

    // ── 4. Adaptive Noise Compensation ────────────────────────────────────
    // In noisy environments, RMS is unreliable — reduce its weight and
    // compensate by increasing pitch deviation weight.
    let wPitch = 0.30;
    let wRMS = 0.25;
    const wMFCC = 0.20;
    const wCentroid = 0.15;
    const wZCR = 0.10;

    if (noiseFloor > NOISE_HIGH_THRESHOLD) {
        // Reduce RMS weight by 20% of its value, redistribute to pitch
        const rmsReduction = wRMS * 0.20; // 0.05
        wRMS -= rmsReduction;
        wPitch += rmsReduction;
    }

    // ── 5. Weighted Combination ────────────────────────────────────────────
    const rawScore =
        pitchScore * wPitch +
        rmsScore * wRMS +
        mfccScore * wMFCC +
        centroidScore * wCentroid +
        zcrScore * wZCR;

    const clampedScore = Math.max(0, Math.min(1, rawScore));

    // ── 6. Spike Limiter ───────────────────────────────────────────────────
    return _applySpikeLimiter(clampedScore);
};

/**
 * Reset module-level stress state.
 * Must be called when the audio pipeline stops to clear the spike limiter.
 */
export const resetStressState = () => {
    previousStressScore = 0;
};

// ─── Unchanged Public Exports ──────────────────────────────────────────────

/**
 * Get stress level label
 * @param {number} score - Stress score (0-1)
 * @returns {string} 'LOW' | 'MEDIUM' | 'HIGH'
 */
export const getStressLevel = (score) => {
    if (score < 0.3) return 'LOW';
    if (score < 0.75) return 'MEDIUM';
    return 'HIGH';
};

/**
 * Get color for stress level
 * @param {string} level
 * @returns {string} CSS color
 */
export const getStressColor = (level) => {
    const colors = {
        LOW: '#10b981',
        MEDIUM: '#f59e0b',
        HIGH: '#ef4444',
    };
    return colors[level] || colors.LOW;
};

/**
 * Placeholder for future ML model inference
 * @param {Object} featureMatrix
 * @param {Object|null} baseline
 * @param {number} noiseFloor
 * @returns {Promise<number>} Stress probability
 */
export const runMLInference = async (featureMatrix, baseline = null, noiseFloor = 0) => {
    // TODO: Replace with actual TensorFlow Lite model inference
    return computeStressScore(featureMatrix, baseline, noiseFloor);
};

/**
 * Calculate audio risk weight for Risk Engine.
 * Audio contribution (0.3 × score) cannot alone exceed emergency threshold
 * without motion or gesture confirmation (gesture=0.5, motion=0.2 weights).
 * @param {number} stressScore - Stress score (0-1)
 * @returns {number} Weighted contribution (0.3 × score, max 0.3)
 */
export const calculateAudioRiskWeight = (stressScore) => {
    const AUDIO_WEIGHT = 0.3; // Audio contributes max 30% to overall risk
    return AUDIO_WEIGHT * stressScore;
};

// ─── Private Helpers ───────────────────────────────────────────────────────

/**
 * Apply spike limiter: cap stress increase to SPIKE_LIMIT per step.
 * Updates previousStressScore in place.
 * @param {number} newScore
 * @returns {number} Rate-limited score
 */
const _applySpikeLimiter = (newScore) => {
    const delta = newScore - previousStressScore;
    if (delta > SPIKE_LIMIT) {
        newScore = previousStressScore + SPIKE_LIMIT;
    }
    // Allow fast decay (no lower-bound limiter — stress can drop quickly)
    previousStressScore = newScore;
    return newScore;
};

/**
 * Calculate MFCC temporal variance.
 * Measures how much MFCCs change frame-to-frame (distressed speech indicator).
 * @param {number[][]} mfccMatrix - [time, coeffs]
 * @returns {number} Temporal variance
 */
const _calculateMFCCTemporalVariance = (mfccMatrix) => {
    if (mfccMatrix.length < 2) return 0;

    let totalDifference = 0;
    const numCoeffs = mfccMatrix[0].length;

    for (let t = 1; t < mfccMatrix.length; t++) {
        for (let c = 0; c < numCoeffs; c++) {
            const diff = mfccMatrix[t][c] - mfccMatrix[t - 1][c];
            totalDifference += diff * diff;
        }
    }

    return Math.sqrt(totalDifference / (mfccMatrix.length - 1) / numCoeffs);
};
