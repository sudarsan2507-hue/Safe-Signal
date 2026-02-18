/**
 * Audio Pipeline Controller
 * Orchestrates the entire audio stress detection pipeline.
 *
 * Enhancements (v2):
 *  - 5-second baseline calibration phase on start
 *  - Ambient noise floor tracking during silent segments
 *  - Passes baseline + noiseFloor to stressInference for deviation-based scoring
 *  - Emits isCalibrating + baseline in onStressUpdate callback
 */

import { initAudioCapture, releaseAudioCapture } from './audioCapture.js';
import { getAudioProcessor } from './audioProcessor.js';
import { buildFeatureMatrix, calculateStats } from './featureExtractor.js';
import { computeStressScore, calculateAudioRiskWeight, resetStressState } from './stressInference.js';
import { getTemporalSmoother } from './smoothing.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Duration of the calibration phase in milliseconds */
const CALIBRATION_DURATION_MS = 5000;

/** Number of silent-frame RMS samples to keep for noise floor estimation */
const MAX_NOISE_SAMPLES = 20;

// ─── Controller ────────────────────────────────────────────────────────────

class AudioPipelineController {
    constructor() {
        this.isRunning = false;
        this.audioContext = null;
        this.analyser = null;
        this.processor = null;
        this.smoother = null;
        this.processingInterval = null;
        this.currentStressScore = 0;
        this.mfccHistory = [];
        this.maxMFCCHistory = 80; // Last 80 frames (~2 seconds)

        // ── Calibration state ──────────────────────────────────────────────
        this.isCalibrating = false;
        this.calibrationStartTime = null;
        this.calibrationSamples = []; // Array of { pitch, rms, centroid }
        this.baseline = null;         // { pitch, rms, centroid } — set after calibration

        // ── Noise floor tracking ───────────────────────────────────────────
        this.noiseSamples = [];       // RMS values from silent frames
        this.noiseFloor = 0;          // Rolling mean of noiseSamples

        // Callbacks
        this.onStressUpdate = null;
    }

    /**
     * Initialize and start the audio pipeline.
     * Begins a 5-second calibration phase before stress scoring starts.
     * @param {function} onStressUpdate - Callback for stress score updates
     */
    async start(onStressUpdate) {
        if (this.isRunning) {
            console.warn('Audio pipeline already running');
            return;
        }

        try {
            // Initialize audio capture
            const audioSetup = await initAudioCapture();
            this.audioContext = audioSetup.context;
            this.analyser = audioSetup.analyser;

            // Initialize processor and smoother
            this.processor = getAudioProcessor(this.audioContext.sampleRate);
            this.smoother = getTemporalSmoother(5); // 5-second EMA window

            this.onStressUpdate = onStressUpdate;
            this.isRunning = true;

            // ── Start calibration phase ────────────────────────────────────
            this.isCalibrating = true;
            this.calibrationStartTime = Date.now();
            this.calibrationSamples = [];
            this.baseline = null;

            // Emit initial calibrating state immediately
            this._emitUpdate(0);

            // Start processing loop (every 500ms)
            this.processingInterval = setInterval(() => {
                this.processAudioFrame();
            }, 500);

            console.log('✅ Audio pipeline started — calibrating for 5 seconds…');
        } catch (error) {
            console.error('Failed to start audio pipeline:', error);
            throw error;
        }
    }

    /**
     * Process a single audio frame (called every 500ms).
     */
    async processAudioFrame() {
        if (!this.isRunning || !this.analyser) return;

        try {
            // Get audio data from analyser
            const bufferLength = this.analyser.fftSize;
            const timeDataArray = new Float32Array(bufferLength);
            this.analyser.getFloatTimeDomainData(timeDataArray);

            // Apply noise reduction
            const cleanedBuffer = this.processor.applyNoiseReduction(timeDataArray);

            // Voice Activity Detection
            const hasVoice = this.processor.detectVoiceActivity(cleanedBuffer);

            // ── Noise floor tracking (silent frames only) ──────────────────
            if (!hasVoice) {
                const silentRMS = _computeRMS(cleanedBuffer);
                this.noiseSamples.push(silentRMS);
                if (this.noiseSamples.length > MAX_NOISE_SAMPLES) {
                    this.noiseSamples.shift();
                }
                this.noiseFloor = this.noiseSamples.reduce((a, b) => a + b, 0) / this.noiseSamples.length;

                // No voice → stress = 0 (VAD gate in stressInference will also enforce this)
                this.updateStressScore(0);
                return;
            }

            // Add to rolling buffer
            this.processor.addToRollingBuffer(cleanedBuffer);

            // Get rolling window (1.5 seconds)
            const window = this.processor.getRollingWindow(1.5);

            if (window.length < 1000) {
                // Not enough data yet
                return;
            }

            // Split into 25ms frames
            const frames = this.processor.splitIntoFrames(window);

            // Extract features
            const featureMatrix = buildFeatureMatrix(
                frames,
                this.audioContext.sampleRate,
                40 // 40 MFCC coefficients
            );

            // Store MFCC for visualization
            this.mfccHistory.push(...featureMatrix.mfcc);
            if (this.mfccHistory.length > this.maxMFCCHistory) {
                this.mfccHistory = this.mfccHistory.slice(-this.maxMFCCHistory);
            }

            // ── Calibration phase ──────────────────────────────────────────
            const elapsed = Date.now() - this.calibrationStartTime;

            if (this.isCalibrating) {
                // Collect voiced-frame statistics for baseline
                const voicedPitch = featureMatrix.pitch.filter(p => p > 0);
                const pitchStats = calculateStats(voicedPitch.length > 0 ? voicedPitch : [0]);
                const rmsStats = calculateStats(featureMatrix.rms);
                const centroidStats = calculateStats(featureMatrix.spectralCentroid);

                this.calibrationSamples.push({
                    pitch: pitchStats.mean,
                    rms: rmsStats.mean,
                    centroid: centroidStats.mean,
                });

                if (elapsed >= CALIBRATION_DURATION_MS) {
                    // Calibration complete — compute baseline from collected samples
                    this.baseline = _computeBaseline(this.calibrationSamples);
                    this.isCalibrating = false;
                    console.log('🎯 Calibration complete. Baseline:', this.baseline);
                }

                // During calibration, stress score is always 0
                this.updateStressScore(0);
                return;
            }

            // ── Normal stress computation ──────────────────────────────────
            const rawStressScore = computeStressScore(
                featureMatrix,
                this.baseline,
                this.noiseFloor
            );

            // Apply temporal smoothing (EMA α=0.3, 5-second window)
            this.smoother.addSample(rawStressScore);
            const smoothedScore = this.smoother.getSmoothScore();

            this.updateStressScore(smoothedScore);

        } catch (error) {
            console.error('Error processing audio frame:', error);
        }
    }

    /**
     * Update stress score and notify consumer.
     * @param {number} score
     */
    updateStressScore(score) {
        this.currentStressScore = score;
        this._emitUpdate(score);
    }

    /**
     * Emit stress update to registered callback.
     * @param {number} score
     */
    _emitUpdate(score) {
        if (this.onStressUpdate) {
            const audioRiskWeight = calculateAudioRiskWeight(score);
            this.onStressUpdate({
                stressScore: score,
                audioRiskWeight,
                mfccData: this.mfccHistory,
                analyser: this.analyser,
                isCalibrating: this.isCalibrating,  // UI can show "Calibrating…"
                baseline: this.baseline,             // Available for debug mode display
            });
        }
    }

    /**
     * Stop the audio pipeline and reset all state.
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }

        releaseAudioCapture();

        if (this.processor) {
            this.processor.clearBuffer();
        }

        if (this.smoother) {
            this.smoother.reset();
        }

        // Reset all enhanced state
        this.mfccHistory = [];
        this.currentStressScore = 0;
        this.isCalibrating = false;
        this.calibrationStartTime = null;
        this.calibrationSamples = [];
        this.baseline = null;
        this.noiseSamples = [];
        this.noiseFloor = 0;

        // Reset spike limiter in stressInference
        resetStressState();

        console.log('🛑 Audio pipeline stopped');
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    /** @returns {number} Current stress score */
    getStressScore() { return this.currentStressScore; }

    /** @returns {AnalyserNode} Analyser node for visualization */
    getAnalyser() { return this.analyser; }

    /** @returns {Array} MFCC history for visualization */
    getMFCCHistory() { return this.mfccHistory; }

    /** @returns {boolean} Whether pipeline is active */
    isActive() { return this.isRunning; }

    /** @returns {boolean} Whether calibration is in progress */
    getIsCalibrating() { return this.isCalibrating; }

    /** @returns {Object|null} Calibration baseline { pitch, rms, centroid } */
    getBaseline() { return this.baseline; }

    /** @returns {number} Current estimated ambient noise floor */
    getNoiseFloor() { return this.noiseFloor; }
}

// ─── Private Helpers ───────────────────────────────────────────────────────

/**
 * Compute RMS energy of a buffer.
 * @param {Float32Array} buffer
 * @returns {number}
 */
const _computeRMS = (buffer) => {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
};

/**
 * Compute baseline from calibration samples by averaging.
 * @param {Array<{pitch, rms, centroid}>} samples
 * @returns {{ pitch: number, rms: number, centroid: number }}
 */
const _computeBaseline = (samples) => {
    if (samples.length === 0) return { pitch: 0, rms: 0, centroid: 0 };
    const n = samples.length;
    return {
        pitch: samples.reduce((acc, s) => acc + s.pitch, 0) / n,
        rms: samples.reduce((acc, s) => acc + s.rms, 0) / n,
        centroid: samples.reduce((acc, s) => acc + s.centroid, 0) / n,
    };
};

// ─── Singleton ─────────────────────────────────────────────────────────────

let pipelineInstance = null;

/**
 * Get audio pipeline controller singleton.
 * @returns {AudioPipelineController}
 */
export const getAudioPipeline = () => {
    if (!pipelineInstance) {
        pipelineInstance = new AudioPipelineController();
    }
    return pipelineInstance;
};

/**
 * Reset audio pipeline (creates a fresh instance on next getAudioPipeline() call).
 */
export const resetAudioPipeline = () => {
    if (pipelineInstance) {
        pipelineInstance.stop();
    }
    pipelineInstance = null;
};
