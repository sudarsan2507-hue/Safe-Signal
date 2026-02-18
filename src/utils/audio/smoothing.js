/**
 * Temporal Smoothing Module
 * Applies 5-second sliding window smoothing using exponential moving average
 */

class TemporalSmoother {
    constructor(windowSeconds = 5) {
        this.windowSeconds = windowSeconds;
        this.samples = []; // Array of {value, timestamp}
        this.smoothedValue = 0;

        // Exponential moving average alpha
        // For 5-second effective window: α ≈ 0.3
        this.alpha = 0.3;
    }

    /**
     * Add a new sample with timestamp
     * @param {number} value - Stress score (0-1)
     * @param {number} timestamp - Unix timestamp in ms
     */
    addSample(value, timestamp = Date.now()) {
        // Add new sample
        this.samples.push({ value, timestamp });

        // Remove old samples outside window
        const cutoffTime = timestamp - (this.windowSeconds * 1000);
        this.samples = this.samples.filter(s => s.timestamp > cutoffTime);

        // Update smoothed value using EMA
        if (this.samples.length === 1) {
            this.smoothedValue = value;
        } else {
            this.smoothedValue = this.alpha * value + (1 - this.alpha) * this.smoothedValue;
        }
    }

    /**
     * Get current smoothed score
     * @returns {number} Smoothed stress score (0-1)
     */
    getSmoothScore() {
        return this.smoothedValue;
    }

    /**
     * Get raw (unsmoothed) average of window
     * @returns {number}
     */
    getWindowAverage() {
        if (this.samples.length === 0) return 0;
        const sum = this.samples.reduce((acc, s) => acc + s.value, 0);
        return sum / this.samples.length;
    }

    /**
     * Get number of samples in current window
     * @returns {number}
     */
    getWindowSize() {
        return this.samples.length;
    }

    /**
     * Reset the smoother
     */
    reset() {
        this.samples = [];
        this.smoothedValue = 0;
    }

    /**
     * Get all samples in window (for debugging)
     * @returns {Array}
     */
    getSamples() {
        return [...this.samples];
    }

    /**
     * Get standard deviation of window
     * @returns {number}
     */
    getWindowStd() {
        if (this.samples.length < 2) return 0;

        const mean = this.getWindowAverage();
        const variance = this.samples.reduce((acc, s) => {
            return acc + Math.pow(s.value - mean, 2);
        }, 0) / this.samples.length;

        return Math.sqrt(variance);
    }

    /**
     * Check if score is trending upward
     * @returns {boolean}
     */
    isTrendingUp() {
        if (this.samples.length < 3) return false;

        const recent = this.samples.slice(-3);
        return recent[2].value > recent[1].value && recent[1].value > recent[0].value;
    }

    /**
     * Check if score is stable (low variance)
     * @returns {boolean}
     */
    isStable() {
        return this.getWindowStd() < 0.1;
    }
}

// Singleton instance
let smootherInstance = null;

/**
 * Get temporal smoother instance
 * @param {number} windowSeconds
 * @returns {TemporalSmoother}
 */
export const getTemporalSmoother = (windowSeconds = 5) => {
    if (!smootherInstance) {
        smootherInstance = new TemporalSmoother(windowSeconds);
    }
    return smootherInstance;
};

/**
 * Reset temporal smoother
 */
export const resetTemporalSmoother = () => {
    if (smootherInstance) {
        smootherInstance.reset();
    }
};

/**
 * Create a new independent smoother (for testing)
 * @param {number} windowSeconds
 * @returns {TemporalSmoother}
 */
export const createSmoother = (windowSeconds = 5) => {
    return new TemporalSmoother(windowSeconds);
};
