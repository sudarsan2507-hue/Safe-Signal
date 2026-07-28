/**
 * Motion Pipeline — real accelerometer input via the DeviceMotion API.
 *
 * Replaces the previous placeholder that returned Math.random(). A random
 * number is worse than no sensor at all: it feeds noise into the risk score
 * while presenting itself in the UI as a real measurement.
 *
 * Availability is reported honestly. Most desktop browsers never fire
 * devicemotion, and iOS requires an explicit permission gesture, so callers
 * must be able to tell "calm" apart from "not measuring".
 */

/** Gravity magnitude used to centre acceleration-including-gravity readings. */
const GRAVITY = 9.81;

/** Seconds of history retained for variability analysis. */
const HISTORY_MS = 3000;

/** Jerk magnitude (m/s²) treated as a fully abnormal movement spike. */
const SPIKE_REFERENCE = 12;

/** Readings needed before a score is emitted. */
const MIN_SAMPLES = 8;

/** Gap after the last event beyond which the stream counts as stalled. */
const SENSOR_TIMEOUT_MS = 2500;

/**
 * How long to wait for a first reading before concluding there is no sensor.
 *
 * Desktop browsers define DeviceMotionEvent whether or not the machine has an
 * accelerometer, so feature detection alone cannot tell them apart — the only
 * reliable signal is that no event ever arrives. Without this the UI would sit
 * on "waiting for sensor data" forever on every laptop.
 */
const SENSOR_PROBE_MS = 3000;

class MotionPipelineController {
    constructor() {
        this.isRunning = false;
        this.samples = [];
        this.motionScore = 0;
        this.lastEventTime = 0;
        this.available = false;
        this.permissionState = 'unknown'; // 'unknown' | 'granted' | 'denied' | 'unsupported'
        this.handler = null;
        this.onUpdate = null;
        this.hasReceivedData = false;
        this.probeTimedOut = false;
        this.probeTimer = null;
    }

    /** @returns {boolean} Whether this browser exposes DeviceMotion at all */
    static isSupported() {
        return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
    }

    /**
     * Request permission where the platform requires it (iOS 13+).
     * @returns {Promise<'granted'|'denied'|'unsupported'>}
     */
    static async requestPermission() {
        if (!MotionPipelineController.isSupported()) return 'unsupported';

        const requestFn = window.DeviceMotionEvent.requestPermission;
        if (typeof requestFn !== 'function') {
            // Platforms without an explicit prompt grant access implicitly.
            return 'granted';
        }

        try {
            const result = await requestFn();
            return result === 'granted' ? 'granted' : 'denied';
        } catch {
            return 'denied';
        }
    }

    /**
     * Begin listening for motion events.
     * @param {(update: {motionScore: number, available: boolean}) => void} onUpdate
     * @returns {Promise<boolean>} whether the sensor started
     */
    async start(onUpdate) {
        if (this.isRunning) return this.available;

        this.onUpdate = onUpdate;

        if (!MotionPipelineController.isSupported()) {
            this.permissionState = 'unsupported';
            this.available = false;
            this.emit();
            return false;
        }

        const permission = await MotionPipelineController.requestPermission();
        this.permissionState = permission;
        if (permission !== 'granted') {
            this.available = false;
            this.emit();
            return false;
        }

        this.handler = (event) => this.handleMotion(event);
        window.addEventListener('devicemotion', this.handler);
        this.isRunning = true;
        this.samples = [];
        this.lastEventTime = 0;
        this.hasReceivedData = false;
        this.probeTimedOut = false;

        // If nothing has arrived by now, this device has no usable sensor.
        this.probeTimer = setTimeout(() => {
            if (!this.hasReceivedData) {
                this.probeTimedOut = true;
                this.emit();
            }
        }, SENSOR_PROBE_MS);

        this.emit();
        return true;
    }

    /**
     * @param {DeviceMotionEvent} event
     */
    handleMotion(event) {
        const acc = event.accelerationIncludingGravity || event.acceleration;
        if (!acc || acc.x == null) return;

        const now = Date.now();
        this.lastEventTime = now;
        this.available = true;
        this.hasReceivedData = true;
        this.probeTimedOut = false;

        // Magnitude minus gravity: roughly zero at rest in any orientation.
        const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
        const netAcceleration = Math.abs(magnitude - GRAVITY);

        this.samples.push({ value: netAcceleration, time: now });
        const cutoff = now - HISTORY_MS;
        while (this.samples.length > 0 && this.samples[0].time < cutoff) {
            this.samples.shift();
        }

        this.motionScore = this.computeScore();
        this.emit();
    }

    /**
     * Score how abnormal recent movement is: sustained agitation plus the
     * single sharpest spike in the window.
     * @returns {number} 0–1
     */
    computeScore() {
        if (this.samples.length < MIN_SAMPLES) return 0;

        const values = this.samples.map((s) => s.value);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const peak = values.reduce((a, b) => Math.max(a, b), 0);

        // Ordinary walking sits around 1–3 m/s² of net acceleration; a fall,
        // struggle, or violent shake produces markedly more.
        const sustained = Math.min(mean / 6, 1);
        const spike = Math.min(peak / SPIKE_REFERENCE, 1);

        return Math.max(0, Math.min(1, sustained * 0.6 + spike * 0.4));
    }

    /** @returns {boolean} True if events are still arriving */
    isReceivingData() {
        if (!this.isRunning || this.lastEventTime === 0) return false;
        return Date.now() - this.lastEventTime < SENSOR_TIMEOUT_MS;
    }

    /**
     * Current sensor state, distinguishing "no hardware" from "not yet".
     * @returns {'unsupported'|'denied'|'waiting'|'no-hardware'|'stalled'|'active'}
     */
    getStatus() {
        if (this.permissionState === 'unsupported') return 'unsupported';
        if (this.permissionState === 'denied') return 'denied';
        if (this.isReceivingData()) return 'active';
        if (this.hasReceivedData) return 'stalled';
        if (this.probeTimedOut) return 'no-hardware';
        return 'waiting';
    }

    emit() {
        this.onUpdate?.({
            motionScore: this.motionScore,
            available: this.available && this.isReceivingData(),
            permissionState: this.permissionState,
            status: this.getStatus(),
        });
    }

    /** @returns {number} */
    getMotionScore() {
        return this.isReceivingData() ? this.motionScore : 0;
    }

    /** @returns {boolean} */
    isAvailable() {
        return this.available && this.isReceivingData();
    }

    stop() {
        if (this.handler) {
            window.removeEventListener('devicemotion', this.handler);
            this.handler = null;
        }
        if (this.probeTimer) {
            clearTimeout(this.probeTimer);
            this.probeTimer = null;
        }
        this.isRunning = false;
        this.samples = [];
        this.motionScore = 0;
        this.available = false;
        this.lastEventTime = 0;
        this.hasReceivedData = false;
        this.probeTimedOut = false;
        this.onUpdate = null;
    }
}

let instance = null;

/** @returns {MotionPipelineController} */
export const getMotionPipeline = () => {
    if (!instance) instance = new MotionPipelineController();
    return instance;
};

export const resetMotionPipeline = () => {
    instance?.stop();
    instance = null;
};

export { MotionPipelineController };
