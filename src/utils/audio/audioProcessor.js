/**
 * Audio Processing Module
 * Handles noise reduction, VAD, and rolling window buffering
 */

class AudioProcessor {
    constructor(sampleRate = 16000) {
        this.sampleRate = sampleRate;
        this.rollingBuffer = [];
        this.maxBufferSize = sampleRate * 2; // 2 seconds
        this.noiseThreshold = 0.01; // Adaptive
        this.vadEnergyThreshold = 0.02;
        this.vadZCRThreshold = 0.3;
    }

    /**
     * Apply noise gate (simple threshold-based noise reduction)
     * @param {Float32Array} audioBuffer
     * @returns {Float32Array}
     */
    applyNoiseReduction(audioBuffer) {
        const cleaned = new Float32Array(audioBuffer.length);

        for (let i = 0; i < audioBuffer.length; i++) {
            // Noise gate: suppress signals below threshold
            if (Math.abs(audioBuffer[i]) < this.noiseThreshold) {
                cleaned[i] = 0;
            } else {
                cleaned[i] = audioBuffer[i];
            }
        }

        return cleaned;
    }

    /**
     * Voice Activity Detection (energy + ZCR based)
     * @param {Float32Array} audioBuffer
     * @returns {boolean} true if voice detected
     */
    detectVoiceActivity(audioBuffer) {
        // Calculate RMS energy
        let sumSquares = 0;
        for (let i = 0; i < audioBuffer.length; i++) {
            sumSquares += audioBuffer[i] * audioBuffer[i];
        }
        const rms = Math.sqrt(sumSquares / audioBuffer.length);

        // Calculate Zero Crossing Rate
        let zeroCrossings = 0;
        for (let i = 1; i < audioBuffer.length; i++) {
            if ((audioBuffer[i] >= 0 && audioBuffer[i - 1] < 0) ||
                (audioBuffer[i] < 0 && audioBuffer[i - 1] >= 0)) {
                zeroCrossings++;
            }
        }
        const zcr = zeroCrossings / audioBuffer.length;

        // Voice has moderate energy and moderate ZCR
        // Noise has low energy, silence has low energy and low ZCR
        const hasEnergy = rms > this.vadEnergyThreshold;
        const hasVoicelike = zcr > 0.05 && zcr < this.vadZCRThreshold;

        return hasEnergy && hasVoicelike;
    }

    /**
     * Add samples to rolling buffer
     * @param {Float32Array} samples
     */
    addToRollingBuffer(samples) {
        // Add new samples
        for (let i = 0; i < samples.length; i++) {
            this.rollingBuffer.push(samples[i]);
        }

        // Trim to max size (keep latest 2 seconds)
        if (this.rollingBuffer.length > this.maxBufferSize) {
            this.rollingBuffer = this.rollingBuffer.slice(-this.maxBufferSize);
        }
    }

    /**
     * Get rolling window of specified size (in seconds)
     * @param {number} windowSize - Size in seconds (default 1.5)
     * @returns {Float32Array}
     */
    getRollingWindow(windowSize = 1.5) {
        const sampleCount = Math.floor(this.sampleRate * windowSize);
        const start = Math.max(0, this.rollingBuffer.length - sampleCount);
        return new Float32Array(this.rollingBuffer.slice(start));
    }

    /**
     * Get the full buffer (last 2 seconds)
     * @returns {Float32Array}
     */
    getFullBuffer() {
        return new Float32Array(this.rollingBuffer);
    }

    /**
     * Clear the buffer
     */
    clearBuffer() {
        this.rollingBuffer = [];
    }

    /**
     * Update noise threshold adaptively
     * @param {Float32Array} audioBuffer
     */
    updateNoiseThreshold(audioBuffer) {
        // Calculate background noise level (10th percentile)
        const sorted = Array.from(audioBuffer).map(Math.abs).sort((a, b) => a - b);
        const percentile10 = sorted[Math.floor(sorted.length * 0.1)];

        // Smooth update
        this.noiseThreshold = this.noiseThreshold * 0.9 + percentile10 * 0.1;
    }

    /**
     * Split audio into frames (25ms each)
     * @param {Float32Array} audioBuffer
     * @returns {Float32Array[]} Array of frames
     */
    splitIntoFrames(audioBuffer) {
        const frameSizeMs = 25;
        const frameSizeSamples = Math.floor((this.sampleRate / 1000) * frameSizeMs);
        const frames = [];

        for (let i = 0; i + frameSizeSamples <= audioBuffer.length; i += frameSizeSamples) {
            frames.push(audioBuffer.slice(i, i + frameSizeSamples));
        }

        return frames;
    }
}

// Singleton instance
let processorInstance = null;

export const getAudioProcessor = (sampleRate = 16000) => {
    if (!processorInstance) {
        processorInstance = new AudioProcessor(sampleRate);
    }
    return processorInstance;
};

export const resetAudioProcessor = () => {
    processorInstance = null;
};
