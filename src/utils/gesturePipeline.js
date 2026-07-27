/**
 * Gesture Pipeline — MediaPipe Hands, closed-fist distress signal.
 * Runs entirely on-device; no frame ever leaves the browser.
 *
 * The hold timer tolerates brief tracking dropouts. Hand tracking flickers
 * constantly in poor light, and a timer that resets on every lost frame can
 * never complete a two-second hold in the conditions this app is built for.
 */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/** Normalized distance below which a fingertip counts as curled toward the palm. */
const FIST_THRESHOLD = 0.12;

/** How long the fist must be held before it counts as a deliberate signal. */
export const FIST_HOLD_DURATION_MS = 2000;

/** Tracking may drop out for this long without resetting the hold. */
const TRACKING_GRACE_MS = 400;

/** Fraction of fingers that must be curled for the frame to read as a fist. */
const FIST_CONFIDENCE_THRESHOLD = 0.6;

/**
 * MediaPipe hand landmark indices.
 * Wrist = 0. Fingertips: index 8, middle 12, ring 16, pinky 20.
 * The thumb is excluded — its curl geometry differs from the fingers.
 */
const FINGERTIP_INDICES = [8, 12, 16, 20];
const PALM_INDICES = [0, 5, 9, 13, 17];

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const MODEL_PATH =
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

class GesturePipelineController {
    constructor() {
        this.handLandmarker = null;
        this.isInitialized = false;
        this.initPromise = null;

        this.fistStartTime = null;
        this.lastFistSeenTime = null;
        this.gestureScore = 0;
        this.isFist = false;
        this.confidence = 0;
        this.lastVideoTime = -1;
        this.lastResult = null;
    }

    /**
     * Load the MediaPipe model. Concurrent calls share one initialisation.
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
                runningMode: 'VIDEO',
                numHands: 1,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });
            this.isInitialized = true;
        })();

        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    /**
     * Analyse one video frame. Call from a requestAnimationFrame loop.
     *
     * @param {HTMLVideoElement} videoEl
     * @returns {{landmarks: Array|null, isFist: boolean, gestureScore: number, confidence: number, holdProgress: number, tracking: boolean}}
     */
    detectFrame(videoEl) {
        const idle = {
            landmarks: null,
            isFist: this.isFist,
            gestureScore: this.gestureScore,
            confidence: 0,
            holdProgress: this.getHoldProgress(),
            tracking: false,
        };

        if (!this.isInitialized || !this.handLandmarker) return idle;
        if (!videoEl || videoEl.readyState < 2) return idle;

        const now = performance.now();

        // MediaPipe rejects repeated timestamps; skip frames the video has not
        // actually advanced past.
        if (videoEl.currentTime === this.lastVideoTime) {
            return { ...idle, ...(this.lastResult ?? {}), holdProgress: this.getHoldProgress() };
        }
        this.lastVideoTime = videoEl.currentTime;

        let result;
        try {
            result = this.handLandmarker.detectForVideo(videoEl, now);
        } catch {
            return idle;
        }

        const landmarks = result?.landmarks?.[0] ?? null;

        if (!landmarks) {
            this.applyTrackingGap(now);
            this.lastResult = { landmarks: null, confidence: 0, tracking: false };
            return {
                landmarks: null,
                isFist: this.isFist,
                gestureScore: this.gestureScore,
                confidence: 0,
                holdProgress: this.getHoldProgress(),
                tracking: false,
            };
        }

        const fistConfidence = this.computeFistConfidence(landmarks);
        this.confidence = fistConfidence;

        if (fistConfidence >= FIST_CONFIDENCE_THRESHOLD) {
            if (this.fistStartTime === null) this.fistStartTime = now;
            this.lastFistSeenTime = now;
            if (now - this.fistStartTime >= FIST_HOLD_DURATION_MS) {
                this.gestureScore = 1;
                this.isFist = true;
            }
        } else {
            this.applyTrackingGap(now);
        }

        this.lastResult = { landmarks, confidence: fistConfidence, tracking: true };

        return {
            landmarks,
            isFist: this.isFist,
            gestureScore: this.gestureScore,
            confidence: fistConfidence,
            holdProgress: this.getHoldProgress(),
            tracking: true,
        };
    }

    /**
     * Handle a frame where the fist was not seen. The hold survives short
     * dropouts and only resets once the grace period lapses.
     * @param {number} now
     */
    applyTrackingGap(now) {
        if (this.fistStartTime === null) return;
        if (this.lastFistSeenTime !== null && now - this.lastFistSeenTime <= TRACKING_GRACE_MS) {
            return;
        }
        this.resetFist();
    }

    /**
     * Fraction of the required hold completed so far.
     * @returns {number} 0–1
     */
    getHoldProgress() {
        if (this.gestureScore === 1) return 1;
        if (this.fistStartTime === null) return 0;
        return Math.min((performance.now() - this.fistStartTime) / FIST_HOLD_DURATION_MS, 1);
    }

    /**
     * Fraction of tracked fingertips curled toward the palm centre.
     * @param {Array<{x: number, y: number}>} landmarks
     * @returns {number} 0–1
     */
    computeFistConfidence(landmarks) {
        let px = 0;
        let py = 0;
        for (const idx of PALM_INDICES) {
            px += landmarks[idx].x;
            py += landmarks[idx].y;
        }
        px /= PALM_INDICES.length;
        py /= PALM_INDICES.length;

        let curled = 0;
        for (const tipIdx of FINGERTIP_INDICES) {
            const tip = landmarks[tipIdx];
            const dist = Math.hypot(tip.x - px, tip.y - py);
            if (dist < FIST_THRESHOLD) curled++;
        }

        return curled / FINGERTIP_INDICES.length;
    }

    /** Clear hold state without unloading the model. */
    resetFist() {
        this.fistStartTime = null;
        this.lastFistSeenTime = null;
        this.isFist = false;
        this.gestureScore = 0;
    }

    /** @returns {number} 0 or 1 */
    getGestureScore() {
        return this.gestureScore;
    }

    /** Release the model and all tracking state. */
    stop() {
        try {
            this.handLandmarker?.close();
        } catch {
            // Closing an already-torn-down landmarker is not actionable.
        }
        this.handLandmarker = null;
        this.isInitialized = false;
        this.initPromise = null;
        this.lastVideoTime = -1;
        this.lastResult = null;
        this.resetFist();
    }
}

let pipelineInstance = null;

/** @returns {GesturePipelineController} */
export const getGesturePipeline = () => {
    if (!pipelineInstance) pipelineInstance = new GesturePipelineController();
    return pipelineInstance;
};

export const resetGesturePipeline = () => {
    pipelineInstance?.stop();
    pipelineInstance = null;
};

export { GesturePipelineController };
