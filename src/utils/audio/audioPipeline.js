/**
 * Audio Pipeline Controller
 * Owns the microphone, drives feature extraction, and emits a stress score.
 *
 * Calibration note: the calibration window is bounded by wall-clock time, not
 * by how much speech we happen to hear. Someone walking alone at night is
 * usually silent — the app's whole premise — so gating the end of calibration
 * on voiced audio would leave it calibrating forever in the exact situation it
 * exists for. Instead the window always closes on time, and if no speech was
 * captured we run without a personal baseline and adopt one opportunistically
 * the first time the user does speak.
 */

import { initAudioCapture, releaseAudioCapture, POLL_INTERVAL_MS } from './audioCapture.js';
import { getAudioProcessor } from './audioProcessor.js';
import { buildFeatureMatrix, calculateStats, getLastExtractionError, clearExtractionError } from './featureExtractor.js';
import { StressEstimator } from './stressInference.js';
import { getTemporalSmoother } from './smoothing.js';

/** Length of the initial calibration window. */
const CALIBRATION_DURATION_MS = 5000;

/** Voiced samples needed before a baseline is considered trustworthy. */
const MIN_BASELINE_SAMPLES = 3;

/** Rolling analysis window in seconds. */
const ANALYSIS_WINDOW_S = 1.5;

/** MFCC frames retained for visualisation. */
const MAX_MFCC_HISTORY = 80;

class AudioPipelineController {
    constructor() {
        this.isRunning = false;
        this.audioContext = null;
        this.analyser = null;
        this.processor = null;
        this.smoother = null;
        this.estimator = new StressEstimator();
        this.processingInterval = null;

        this.currentStressScore = 0;
        this.mfccHistory = [];

        this.isCalibrating = false;
        this.calibrationStartTime = null;
        this.calibrationSamples = [];
        this.baseline = null;

        this.sampleRate = 16000;
        this.onStressUpdate = null;
        this.lastError = null;
    }

    /**
     * Start capture and analysis.
     * @param {(update: Object) => void} onStressUpdate
     */
    async start(onStressUpdate) {
        if (this.isRunning) return;

        clearExtractionError();
        this.onStressUpdate = onStressUpdate;

        const audioSetup = await initAudioCapture();
        this.audioContext = audioSetup.context;
        this.analyser = audioSetup.analyser;
        this.sampleRate = audioSetup.sampleRate;

        this.processor = getAudioProcessor(this.sampleRate);
        this.processor.clearBuffer();

        this.smoother = getTemporalSmoother(5);
        this.smoother.reset();

        this.estimator.reset();

        this.isRunning = true;
        this.isCalibrating = true;
        this.calibrationStartTime = Date.now();
        this.calibrationSamples = [];
        this.baseline = null;
        this.mfccHistory = [];
        this.lastError = null;

        this.emitUpdate(0);

        this.processingInterval = setInterval(() => {
            this.processAudioFrame();
        }, POLL_INTERVAL_MS);
    }

    /** Analyse the audio captured since the last poll. */
    processAudioFrame() {
        if (!this.isRunning || !this.analyser) return;

        try {
            const timeData = new Float32Array(this.analyser.fftSize);
            this.analyser.getFloatTimeDomainData(timeData);

            const hasVoice = this.processor.detectVoiceActivity(timeData);

            // Close the calibration window on schedule, whether or not anyone
            // has spoken. This runs before any early return below.
            const calibrationElapsed = Date.now() - this.calibrationStartTime;
            if (this.isCalibrating && calibrationElapsed >= CALIBRATION_DURATION_MS) {
                this.finishCalibration();
            }

            if (!hasVoice) {
                this.processor.updateNoiseFloor(timeData);
                this.updateStressScore(this.estimator.applyLimit(0));
                return;
            }

            this.processor.addToRollingBuffer(timeData);

            const window = this.processor.getRollingWindow(ANALYSIS_WINDOW_S);
            const frames = this.processor.splitIntoFrames(window);
            if (frames.length < 2) {
                this.updateStressScore(this.estimator.applyLimit(0));
                return;
            }

            const featureMatrix = buildFeatureMatrix(frames, this.sampleRate);

            const extractionError = getLastExtractionError();
            if (extractionError && extractionError !== this.lastError) {
                // Surface it instead of letting silent zeros masquerade as calm.
                this.lastError = extractionError;
                console.error('[SafeSignal] audio feature extraction problem:', extractionError);
            }

            this.mfccHistory.push(...featureMatrix.mfcc);
            if (this.mfccHistory.length > MAX_MFCC_HISTORY) {
                this.mfccHistory = this.mfccHistory.slice(-MAX_MFCC_HISTORY);
            }

            // Collect baseline material while calibrating, and also afterwards
            // if calibration ended without hearing enough speech.
            if (this.isCalibrating || !this.baseline) {
                this.collectCalibrationSample(featureMatrix);
                if (!this.isCalibrating && this.calibrationSamples.length >= MIN_BASELINE_SAMPLES) {
                    this.baseline = averageSamples(this.calibrationSamples);
                }
            }

            if (this.isCalibrating) {
                this.updateStressScore(0);
                return;
            }

            const raw = this.estimator.update(
                featureMatrix,
                this.baseline,
                this.processor.getNoiseFloor(),
            );

            this.smoother.addSample(raw);
            this.updateStressScore(this.smoother.getSmoothScore());
        } catch (error) {
            this.lastError = error.message;
            console.error('[SafeSignal] audio frame processing failed:', error);
        }
    }

    /**
     * Record one window's worth of baseline statistics.
     * @param {Object} featureMatrix
     */
    collectCalibrationSample(featureMatrix) {
        const voicedPitch = featureMatrix.pitch.filter((p) => p > 0);
        if (voicedPitch.length === 0) return;

        this.calibrationSamples.push({
            pitch: calculateStats(voicedPitch).mean,
            rms: calculateStats(featureMatrix.rms).mean,
            centroid: calculateStats(featureMatrix.spectralCentroid).mean,
        });
    }

    /** Close the calibration window and build a baseline if we have enough data. */
    finishCalibration() {
        this.isCalibrating = false;
        if (this.calibrationSamples.length >= MIN_BASELINE_SAMPLES) {
            this.baseline = averageSamples(this.calibrationSamples);
        } else {
            // Not enough speech was heard. Run without a personal baseline;
            // absolute-threshold scoring applies until one can be formed.
            this.baseline = null;
        }
    }

    /**
     * @param {number} score
     */
    updateStressScore(score) {
        this.currentStressScore = score;
        this.emitUpdate(score);
    }

    /**
     * @param {number} score
     */
    emitUpdate(score) {
        if (!this.onStressUpdate) return;
        this.onStressUpdate({
            stressScore: score,
            mfccData: this.mfccHistory,
            analyser: this.analyser,
            isCalibrating: this.isCalibrating,
            baseline: this.baseline,
            noiseFloor: this.processor?.getNoiseFloor() ?? 0,
            error: this.lastError,
        });
    }

    /** Stop capture and reset all state. */
    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }

        releaseAudioCapture();

        this.processor?.clearBuffer();
        this.smoother?.reset();
        this.estimator.reset();

        this.mfccHistory = [];
        this.currentStressScore = 0;
        this.isCalibrating = false;
        this.calibrationStartTime = null;
        this.calibrationSamples = [];
        this.baseline = null;
        this.analyser = null;
        this.audioContext = null;
        this.onStressUpdate = null;
    }

    getStressScore() { return this.currentStressScore; }
    getAnalyser() { return this.analyser; }
    getMFCCHistory() { return this.mfccHistory; }
    isActive() { return this.isRunning; }
    getIsCalibrating() { return this.isCalibrating; }
    getBaseline() { return this.baseline; }
    getNoiseFloor() { return this.processor?.getNoiseFloor() ?? 0; }
}

/**
 * @param {Array<{pitch: number, rms: number, centroid: number}>} samples
 * @returns {{pitch: number, rms: number, centroid: number}}
 */
const averageSamples = (samples) => {
    if (samples.length === 0) return { pitch: 0, rms: 0, centroid: 0 };
    const n = samples.length;
    return {
        pitch: samples.reduce((acc, s) => acc + s.pitch, 0) / n,
        rms: samples.reduce((acc, s) => acc + s.rms, 0) / n,
        centroid: samples.reduce((acc, s) => acc + s.centroid, 0) / n,
    };
};

let pipelineInstance = null;

/** @returns {AudioPipelineController} */
export const getAudioPipeline = () => {
    if (!pipelineInstance) {
        pipelineInstance = new AudioPipelineController();
    }
    return pipelineInstance;
};

export const resetAudioPipeline = () => {
    pipelineInstance?.stop();
    pipelineInstance = null;
};

export { AudioPipelineController, CALIBRATION_DURATION_MS };
