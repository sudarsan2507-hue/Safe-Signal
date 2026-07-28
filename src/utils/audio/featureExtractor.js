/**
 * Feature Extraction Module
 * MFCC, pitch (F0), RMS, ZCR and spectral centroid for short-time frames.
 *
 * Frames arriving here must be FRAME_SIZE (a power of two) — see audioProcessor.
 * Extraction failures are surfaced through `lastExtractionError` rather than
 * being silently swallowed, because a systematic failure (wrong frame size,
 * bad option) otherwise looks identical to "the room is quiet".
 */

import Meyda from 'meyda';

/** Standard MFCC count for speech. Must not exceed MEL_BANDS. */
export const NUM_MFCC = 13;

/** Mel filterbank size backing the MFCC computation. */
export const MEL_BANDS = 26;

/** Autocorrelation peak below which a frame is treated as unvoiced. */
const VOICING_THRESHOLD = 0.45;

const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 400;

let lastExtractionError = null;

/** @returns {string|null} Most recent extraction failure, if any */
export const getLastExtractionError = () => lastExtractionError;

export const clearExtractionError = () => {
    lastExtractionError = null;
};

/**
 * Extract MFCC coefficients.
 * @param {Float32Array} frame - power-of-two length
 * @param {number} sampleRate
 * @param {number} numCoefficients
 * @returns {Float32Array}
 */
export const extractMFCC = (frame, sampleRate, numCoefficients = NUM_MFCC) => {
    try {
        const features = Meyda.extract(['mfcc'], frame, sampleRate, {
            numberOfMFCCCoefficients: numCoefficients,
            melBands: MEL_BANDS,
        });
        if (!features?.mfcc) {
            lastExtractionError = 'Meyda returned no MFCC data';
            return new Float32Array(numCoefficients);
        }
        return new Float32Array(features.mfcc);
    } catch (error) {
        lastExtractionError = `MFCC extraction failed: ${error.message}`;
        return new Float32Array(numCoefficients);
    }
};

/**
 * Estimate fundamental frequency using normalized autocorrelation.
 *
 * Raw (unnormalized) autocorrelation is biased toward short lags simply
 * because more terms contribute to the sum, which pushes every estimate
 * toward the top of the search range. Normalizing by the energy of both
 * overlapping segments removes that bias and yields a 0–1 peak value we can
 * threshold for voicing.
 *
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @returns {{ hz: number, confidence: number }} hz is 0 when unvoiced
 */
export const extractPitchDetailed = (frame, sampleRate) => {
    const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
    const maxLag = Math.min(Math.floor(sampleRate / MIN_PITCH_HZ), Math.floor(frame.length / 2));

    if (maxLag <= minLag) return { hz: 0, confidence: 0 };

    let bestLag = 0;
    let bestScore = 0;
    const scores = new Float64Array(maxLag + 1);

    for (let lag = minLag; lag <= maxLag; lag++) {
        let dot = 0;
        let energyA = 0;
        let energyB = 0;
        const n = frame.length - lag;

        for (let i = 0; i < n; i++) {
            const a = frame[i];
            const b = frame[i + lag];
            dot += a * b;
            energyA += a * a;
            energyB += b * b;
        }

        const denom = Math.sqrt(energyA * energyB);
        const score = denom > 0 ? dot / denom : 0;
        scores[lag] = score;

        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }

    if (bestLag === 0 || bestScore < VOICING_THRESHOLD) {
        return { hz: 0, confidence: bestScore > 0 ? bestScore : 0 };
    }

    // Parabolic interpolation around the peak for sub-sample lag resolution.
    let refinedLag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
        const prev = scores[bestLag - 1];
        const curr = scores[bestLag];
        const next = scores[bestLag + 1];
        const denom = 2 * (2 * curr - prev - next);
        if (denom !== 0) {
            refinedLag = bestLag + (next - prev) / denom;
        }
    }

    const hz = sampleRate / refinedLag;
    if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) {
        return { hz: 0, confidence: bestScore };
    }

    return { hz, confidence: bestScore };
};

/**
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @returns {number} Pitch in Hz, 0 if unvoiced
 */
export const extractPitch = (frame, sampleRate) => extractPitchDetailed(frame, sampleRate).hz;

/**
 * @param {Float32Array} frame
 * @returns {number} RMS energy
 */
export const extractRMS = (frame) => {
    if (frame.length === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < frame.length; i++) sumSquares += frame[i] * frame[i];
    return Math.sqrt(sumSquares / frame.length);
};

/**
 * @param {Float32Array} frame
 * @returns {number} Zero crossing rate (0-1)
 */
export const extractZCR = (frame) => {
    if (frame.length < 2) return 0;
    let zeroCrossings = 0;
    for (let i = 1; i < frame.length; i++) {
        const prev = frame[i - 1];
        const curr = frame[i];
        if ((curr >= 0 && prev < 0) || (curr < 0 && prev >= 0)) zeroCrossings++;
    }
    return zeroCrossings / frame.length;
};

/**
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @returns {number} Spectral centroid in Hz
 */
export const extractSpectralCentroid = (frame, sampleRate) => {
    try {
        const features = Meyda.extract(['spectralCentroid'], frame, sampleRate);
        if (features?.spectralCentroid == null) return 0;
        // Meyda reports the centroid as a bin index; convert to Hz so the value
        // is comparable against a physical baseline.
        const binCount = frame.length / 2;
        return (features.spectralCentroid / binCount) * (sampleRate / 2);
    } catch (error) {
        lastExtractionError = `Spectral centroid extraction failed: ${error.message}`;
        return 0;
    }
};

/**
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @param {number} numMFCC
 * @returns {Object}
 */
export const extractAllFeatures = (frame, sampleRate, numMFCC = NUM_MFCC) => {
    const pitch = extractPitchDetailed(frame, sampleRate);
    return {
        mfcc: extractMFCC(frame, sampleRate, numMFCC),
        pitch: pitch.hz,
        pitchConfidence: pitch.confidence,
        rms: extractRMS(frame),
        zcr: extractZCR(frame),
        spectralCentroid: extractSpectralCentroid(frame, sampleRate),
    };
};

/**
 * Build a time-ordered feature matrix from consecutive frames.
 * @param {Float32Array[]} frames
 * @param {number} sampleRate
 * @param {number} numMFCC
 * @returns {Object}
 */
export const buildFeatureMatrix = (frames, sampleRate, numMFCC = NUM_MFCC) => {
    const featureMatrix = {
        mfcc: [],
        pitch: [],
        pitchConfidence: [],
        rms: [],
        zcr: [],
        spectralCentroid: [],
        timestamps: [],
    };

    frames.forEach((frame, index) => {
        const features = extractAllFeatures(frame, sampleRate, numMFCC);
        featureMatrix.mfcc.push(Array.from(features.mfcc));
        featureMatrix.pitch.push(features.pitch);
        featureMatrix.pitchConfidence.push(features.pitchConfidence);
        featureMatrix.rms.push(features.rms);
        featureMatrix.zcr.push(features.zcr);
        featureMatrix.spectralCentroid.push(features.spectralCentroid);
        featureMatrix.timestamps.push((index * frame.length) / 2 / sampleRate);
    });

    return featureMatrix;
};

/**
 * Frame-to-frame variability of the pitch period, as a fraction of the mean.
 *
 * Deliberately NOT called jitter. True jitter is a cycle-to-cycle measure, and
 * these frames are ~32 ms — each F0 estimate already averages tens of cycles,
 * so genuine per-cycle perturbation is smoothed away before it reaches here.
 * Measured against synthetic speech, a tenfold increase in real jitter moved
 * this figure only slightly.
 *
 * What it does capture is coarser: how much the pitch contour moves between
 * frames, which mixes prosody with instability. Useful, but weaker evidence
 * than mean pitch elevation, and weighted accordingly.
 *
 * @param {number[]} pitchValues - per-frame F0 in Hz, zeros for unvoiced
 * @returns {number} variability as a fraction of the mean period
 */
export const computePitchVariability = (pitchValues) => {
    const periods = [];
    for (const hz of pitchValues) {
        if (hz > 0) periods.push(1 / hz);
    }
    if (periods.length < 3) return 0;

    let absDiffSum = 0;
    for (let i = 1; i < periods.length; i++) {
        absDiffSum += Math.abs(periods[i] - periods[i - 1]);
    }
    const meanAbsDiff = absDiffSum / (periods.length - 1);
    const meanPeriod = periods.reduce((a, b) => a + b, 0) / periods.length;

    return meanPeriod > 0 ? meanAbsDiff / meanPeriod : 0;
};

/**
 * Frame-to-frame variability of amplitude, as a fraction of the mean.
 * The energy counterpart of computePitchVariability, and subject to the same
 * caveat — this is not per-cycle shimmer.
 *
 * @param {number[]} amplitudeValues - per-frame RMS
 * @returns {number} variability as a fraction of the mean
 */
export const computeEnergyVariability = (amplitudeValues) => {
    const values = amplitudeValues.filter((v) => v > 0);
    if (values.length < 3) return 0;

    let absDiffSum = 0;
    for (let i = 1; i < values.length; i++) {
        absDiffSum += Math.abs(values[i] - values[i - 1]);
    }
    const meanAbsDiff = absDiffSum / (values.length - 1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    return mean > 0 ? meanAbsDiff / mean : 0;
};

/**
 * Summary statistics, computed in a single pass so large arrays do not risk
 * a stack overflow from spreading into Math.min/Math.max.
 * @param {number[]} values
 * @returns {{mean: number, std: number, variance: number, min: number, max: number}}
 */
export const calculateStats = (values) => {
    if (!values || values.length === 0) {
        return { mean: 0, std: 0, variance: 0, min: 0, max: 0 };
    }

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const mean = sum / values.length;

    let sqDiff = 0;
    for (let i = 0; i < values.length; i++) {
        const d = values[i] - mean;
        sqDiff += d * d;
    }
    const variance = sqDiff / values.length;

    return { mean, std: Math.sqrt(variance), variance, min, max };
};
