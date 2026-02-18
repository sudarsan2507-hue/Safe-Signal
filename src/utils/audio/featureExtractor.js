/**
 * Feature Extraction Module
 * Extracts MFCC, pitch, RMS, ZCR, spectral centroid using Meyda.js
 */

import Meyda from 'meyda';

/**
 * Extract MFCC coefficients from audio frame
 * @param {Float32Array} frame - Audio frame (typically 25ms)
 * @param {number} sampleRate
 * @param {number} numCoefficients - Number of MFCCs (30-40)
 * @returns {Float32Array} MFCC coefficients
 */
export const extractMFCC = (frame, sampleRate, numCoefficients = 40) => {
    try {
        const features = Meyda.extract(['mfcc'], frame, sampleRate, {
            numberOfMFCCCoefficients: numCoefficients,
        });

        return features.mfcc ? new Float32Array(features.mfcc) : new Float32Array(numCoefficients);
    } catch (error) {
        console.error('MFCC extraction failed:', error);
        return new Float32Array(numCoefficients);
    }
};

/**
 * Extract pitch (F0) using autocorrelation
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @returns {number} Pitch in Hz (0 if unvoiced)
 */
export const extractPitch = (frame, sampleRate) => {
    const minPitch = 80; // Hz (typical for human voice)
    const maxPitch = 400; // Hz
    const minLag = Math.floor(sampleRate / maxPitch);
    const maxLag = Math.floor(sampleRate / minPitch);

    // Autocorrelation
    let maxCorrelation = 0;
    let bestLag = 0;

    for (let lag = minLag; lag <= maxLag && lag < frame.length / 2; lag++) {
        let correlation = 0;
        for (let i = 0; i < frame.length - lag; i++) {
            correlation += frame[i] * frame[i + lag];
        }

        if (correlation > maxCorrelation) {
            maxCorrelation = correlation;
            bestLag = lag;
        }
    }

    if (bestLag === 0) return 0;

    const pitch = sampleRate / bestLag;
    return pitch >= minPitch && pitch <= maxPitch ? pitch : 0;
};

/**
 * Extract RMS energy from frame
 * @param {Float32Array} frame
 * @returns {number} RMS energy
 */
export const extractRMS = (frame) => {
    let sumSquares = 0;
    for (let i = 0; i < frame.length; i++) {
        sumSquares += frame[i] * frame[i];
    }
    return Math.sqrt(sumSquares / frame.length);
};

/**
 * Extract Zero Crossing Rate
 * @param {Float32Array} frame
 * @returns {number} ZCR (0-1)
 */
export const extractZCR = (frame) => {
    let zeroCrossings = 0;
    for (let i = 1; i < frame.length; i++) {
        if ((frame[i] >= 0 && frame[i - 1] < 0) ||
            (frame[i] < 0 && frame[i - 1] >= 0)) {
            zeroCrossings++;
        }
    }
    return zeroCrossings / frame.length;
};

/**
 * Extract spectral centroid (brightness)
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @returns {number} Spectral centroid in Hz
 */
export const extractSpectralCentroid = (frame, sampleRate) => {
    try {
        const features = Meyda.extract(['spectralCentroid'], frame, sampleRate);
        return features.spectralCentroid || 0;
    } catch (error) {
        console.error('Spectral centroid extraction failed:', error);
        return 0;
    }
};

/**
 * Extract all features from a single frame
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @param {number} numMFCC
 * @returns {Object} All features
 */
export const extractAllFeatures = (frame, sampleRate, numMFCC = 40) => {
    return {
        mfcc: extractMFCC(frame, sampleRate, numMFCC),
        pitch: extractPitch(frame, sampleRate),
        rms: extractRMS(frame),
        zcr: extractZCR(frame),
        spectralCentroid: extractSpectralCentroid(frame, sampleRate),
    };
};

/**
 * Build feature matrix from multiple frames
 * @param {Float32Array[]} frames - Array of audio frames
 * @param {number} sampleRate
 * @param {number} numMFCC
 * @returns {Object} Feature matrix and metadata
 */
export const buildFeatureMatrix = (frames, sampleRate, numMFCC = 40) => {
    const featureMatrix = {
        mfcc: [], // [time, mfcc_coeffs]
        pitch: [],
        rms: [],
        zcr: [],
        spectralCentroid: [],
        timestamps: [],
    };

    frames.forEach((frame, index) => {
        const features = extractAllFeatures(frame, sampleRate, numMFCC);

        featureMatrix.mfcc.push(Array.from(features.mfcc));
        featureMatrix.pitch.push(features.pitch);
        featureMatrix.rms.push(features.rms);
        featureMatrix.zcr.push(features.zcr);
        featureMatrix.spectralCentroid.push(features.spectralCentroid);
        featureMatrix.timestamps.push(index * 0.025); // 25ms frames
    });

    return featureMatrix;
};

/**
 * Calculate feature statistics (for rule-based inference)
 * @param {number[]} values
 * @returns {Object} Statistics
 */
export const calculateStats = (values) => {
    if (values.length === 0) return { mean: 0, std: 0, variance: 0, min: 0, max: 0 };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { mean, std, variance, min, max };
};
