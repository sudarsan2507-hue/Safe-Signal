/**
 * Audio Processing Module
 * Rolling buffer, voice activity detection, and framing for feature extraction.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  1. Frames handed to Meyda MUST be a power of two. Meyda throws
 *     "Buffer size must be a power of 2" otherwise, and because the callers
 *     wrap extraction in try/catch, a wrong frame size fails silently and
 *     every MFCC/centroid value comes back as zero.
 *
 *  2. We do not zero out quiet samples before feature extraction. Hard-gating
 *     a waveform introduces step discontinuities, which spread broadband
 *     energy across the spectrum and corrupt exactly the features we measure.
 *     Noise is handled by measuring the floor and compensating during
 *     inference instead.
 */

/** Frame length in samples. Power of two — required by Meyda. */
export const FRAME_SIZE = 512;

/** Hop between frames (50% overlap), standard for short-time analysis. */
export const HOP_SIZE = FRAME_SIZE / 2;

class AudioProcessor {
    constructor(sampleRate = 16000) {
        this.sampleRate = sampleRate;
        this.maxBufferSize = Math.floor(sampleRate * 2); // 2 seconds

        // Ring buffer — avoids reallocating a JS array of thousands of floats
        // every poll.
        this.buffer = new Float32Array(this.maxBufferSize);
        this.writeIndex = 0;
        this.filled = 0;

        this.noiseFloor = 0;
        this.vadEnergyThreshold = 0.02;
        this.vadZCRThresholdHigh = 0.3;
        this.vadZCRThresholdLow = 0.05;

        this.window = makeHannWindow(FRAME_SIZE);
    }

    /**
     * Rebuild for a different sample rate (e.g. the browser ignored our request).
     * @param {number} sampleRate
     */
    setSampleRate(sampleRate) {
        if (sampleRate === this.sampleRate) return;
        this.sampleRate = sampleRate;
        this.maxBufferSize = Math.floor(sampleRate * 2);
        this.buffer = new Float32Array(this.maxBufferSize);
        this.writeIndex = 0;
        this.filled = 0;
    }

    /**
     * Voice activity detection on the raw (ungated) signal.
     * Speech has both meaningful energy and a mid-range zero-crossing rate;
     * hiss has high ZCR with low energy, rumble has low ZCR.
     * @param {Float32Array} audioBuffer
     * @returns {boolean}
     */
    detectVoiceActivity(audioBuffer) {
        const rms = computeRMS(audioBuffer);

        let zeroCrossings = 0;
        for (let i = 1; i < audioBuffer.length; i++) {
            const prev = audioBuffer[i - 1];
            const curr = audioBuffer[i];
            if ((curr >= 0 && prev < 0) || (curr < 0 && prev >= 0)) zeroCrossings++;
        }
        const zcr = zeroCrossings / audioBuffer.length;

        // Require the signal to sit clearly above the measured ambient floor,
        // so a noisy room raises the bar rather than triggering constantly.
        const energyFloor = Math.max(this.vadEnergyThreshold, this.noiseFloor * 2.5);

        const hasEnergy = rms > energyFloor;
        const hasVoiceShape = zcr > this.vadZCRThresholdLow && zcr < this.vadZCRThresholdHigh;

        return hasEnergy && hasVoiceShape;
    }

    /**
     * Track the ambient noise floor from a segment known to contain no speech.
     * @param {Float32Array} audioBuffer
     */
    updateNoiseFloor(audioBuffer) {
        const rms = computeRMS(audioBuffer);
        // Slow exponential update so a single door slam does not move the floor.
        this.noiseFloor = this.noiseFloor === 0 ? rms : this.noiseFloor * 0.9 + rms * 0.1;
    }

    /** @returns {number} Current ambient noise floor estimate */
    getNoiseFloor() {
        return this.noiseFloor;
    }

    /**
     * Append samples to the rolling buffer.
     * @param {Float32Array} samples
     */
    addToRollingBuffer(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.buffer[this.writeIndex] = samples[i];
            this.writeIndex = (this.writeIndex + 1) % this.maxBufferSize;
        }
        this.filled = Math.min(this.filled + samples.length, this.maxBufferSize);
    }

    /**
     * Read the most recent `windowSize` seconds in chronological order.
     * @param {number} windowSize - seconds
     * @returns {Float32Array}
     */
    getRollingWindow(windowSize = 1.5) {
        const want = Math.min(Math.floor(this.sampleRate * windowSize), this.filled);
        const out = new Float32Array(want);
        // Walk backwards from the write head so samples come out in order.
        let read = (this.writeIndex - want + this.maxBufferSize) % this.maxBufferSize;
        for (let i = 0; i < want; i++) {
            out[i] = this.buffer[read];
            read = (read + 1) % this.maxBufferSize;
        }
        return out;
    }

    /** @returns {number} Samples currently buffered */
    getBufferedSampleCount() {
        return this.filled;
    }

    /** Clear the rolling buffer and noise estimate. */
    clearBuffer() {
        this.buffer.fill(0);
        this.writeIndex = 0;
        this.filled = 0;
        this.noiseFloor = 0;
    }

    /**
     * Split into overlapping, Hann-windowed frames of FRAME_SIZE samples.
     * Windowing tapers each frame's edges, which is what makes the FFT-derived
     * features (MFCC, spectral centroid) meaningful rather than dominated by
     * the rectangular cut at the frame boundary.
     *
     * @param {Float32Array} audioBuffer
     * @returns {Float32Array[]} frames, each exactly FRAME_SIZE long
     */
    splitIntoFrames(audioBuffer) {
        const frames = [];
        for (let start = 0; start + FRAME_SIZE <= audioBuffer.length; start += HOP_SIZE) {
            const frame = new Float32Array(FRAME_SIZE);
            for (let i = 0; i < FRAME_SIZE; i++) {
                frame[i] = audioBuffer[start + i] * this.window[i];
            }
            frames.push(frame);
        }
        return frames;
    }
}

/**
 * Root mean square energy.
 * @param {Float32Array} buffer
 * @returns {number}
 */
export const computeRMS = (buffer) => {
    if (buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
};

/**
 * Periodic Hann window.
 * @param {number} size
 * @returns {Float32Array}
 */
export const makeHannWindow = (size) => {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
    }
    return w;
};

let processorInstance = null;

/**
 * @param {number} sampleRate
 * @returns {AudioProcessor}
 */
export const getAudioProcessor = (sampleRate = 16000) => {
    if (!processorInstance) {
        processorInstance = new AudioProcessor(sampleRate);
    } else {
        processorInstance.setSampleRate(sampleRate);
    }
    return processorInstance;
};

export const resetAudioProcessor = () => {
    processorInstance = null;
};

export const createAudioProcessor = (sampleRate = 16000) => new AudioProcessor(sampleRate);
