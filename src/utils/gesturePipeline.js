/**
 * Gesture Pipeline — MediaPipe Hands (Closed Fist Detection)
 * Runs fully client-side using @mediapipe/tasks-vision WASM.
 * Detects a closed fist held for 2 consecutive seconds → gestureScore = 1.
 */

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Normalized distance threshold below which a fingertip is "curled in" */
const FIST_THRESHOLD = 0.12;

/** Duration (ms) the fist must be held before gestureScore flips to 1 */
const FIST_HOLD_DURATION_MS = 2000;

/**
 * MediaPipe landmark indices for fingertips and palm reference points.
 * See: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
 *
 * Wrist = 0, Palm center approximated from landmarks 0, 5, 9, 13, 17
 * Fingertips: Index=8, Middle=12, Ring=16, Pinky=20
 * Thumb tip = 4 (excluded — thumb curl geometry differs)
 */
const FINGERTIP_INDICES = [8, 12, 16, 20];
const PALM_INDICES = [0, 5, 9, 13, 17];

// ─── Controller ────────────────────────────────────────────────────────────

class GesturePipelineController {
    constructor() {
        this.handLandmarker = null;
        this.isInitialized = false;
        this.isInitializing = false;

        // Fist hold tracking
        this.fistStartTime = null;
        this.gestureScore = 0;
        this.isFist = false;
        this.confidence = 0;
        this.lastLandmarks = null;

        // Performance: track last detection time
        this.lastDetectionTime = 0;
    }

    /**
     * Initialize MediaPipe HandLandmarker.
     * Loads WASM from the installed package's bundled assets.
     */
    async init() {
        if (this.isInitialized || this.isInitializing) return;
        this.isInitializing = true;

        try {
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );

            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath:
                        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'GPU',
                },
                runningMode: 'VIDEO',
                numHands: 1,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });

            this.isInitialized = true;
            this.isInitializing = false;
            console.log('✅ MediaPipe HandLandmarker initialized');
        } catch (error) {
            this.isInitializing = false;
            console.error('Failed to initialize HandLandmarker:', error);
            throw error;
        }
    }

    /**
     * Detect hand landmarks in a video frame.
     * Must be called inside a requestAnimationFrame loop.
     *
     * @param {HTMLVideoElement} videoEl
     * @returns {{ landmarks: Array|null, isFist: boolean, gestureScore: number, confidence: number }}
     */
    detectFrame(videoEl) {
        if (!this.isInitialized || !this.handLandmarker) {
            return { landmarks: null, isFist: false, gestureScore: 0, confidence: 0 };
        }

        if (videoEl.readyState < 2) {
            return { landmarks: null, isFist: false, gestureScore: 0, confidence: 0 };
        }

        const now = performance.now();

        // Run detection
        const result = this.handLandmarker.detectForVideo(videoEl, now);

        if (!result.landmarks || result.landmarks.length === 0) {
            // No hand detected — reset fist timer
            this._resetFist();
            return {
                landmarks: null,
                isFist: false,
                gestureScore: this.gestureScore,
                confidence: 0,
            };
        }

        const landmarks = result.landmarks[0]; // First hand only
        this.lastLandmarks = landmarks;

        // Compute fist confidence
        const fistConf = this._computeFistConfidence(landmarks);
        this.confidence = fistConf;
        const currentlyFist = fistConf > 0.6;

        // 2-second hold logic
        if (currentlyFist) {
            if (this.fistStartTime === null) {
                this.fistStartTime = now;
            }
            const held = now - this.fistStartTime;
            if (held >= FIST_HOLD_DURATION_MS) {
                this.gestureScore = 1;
                this.isFist = true;
            }
        } else {
            this._resetFist();
        }

        return {
            landmarks,
            isFist: this.isFist,
            gestureScore: this.gestureScore,
            confidence: fistConf,
            holdProgress: this.fistStartTime
                ? Math.min((now - this.fistStartTime) / FIST_HOLD_DURATION_MS, 1)
                : 0,
        };
    }

    /**
     * Compute a 0–1 fist confidence score.
     * Measures how many fingertips are within FIST_THRESHOLD of the palm center.
     * @param {Array} landmarks - 21 normalized {x,y,z} landmarks
     * @returns {number} 0–1 confidence
     */
    _computeFistConfidence(landmarks) {
        // Compute palm center as mean of PALM_INDICES
        let px = 0, py = 0;
        for (const idx of PALM_INDICES) {
            px += landmarks[idx].x;
            py += landmarks[idx].y;
        }
        px /= PALM_INDICES.length;
        py /= PALM_INDICES.length;

        // Count fingertips within threshold
        let curledCount = 0;
        for (const tipIdx of FINGERTIP_INDICES) {
            const tip = landmarks[tipIdx];
            const dist = Math.sqrt((tip.x - px) ** 2 + (tip.y - py) ** 2);
            if (dist < FIST_THRESHOLD) curledCount++;
        }

        return curledCount / FINGERTIP_INDICES.length; // 0, 0.25, 0.5, 0.75, or 1.0
    }

    /** Reset fist hold state */
    _resetFist() {
        this.fistStartTime = null;
        this.isFist = false;
        this.gestureScore = 0;
    }

    /** Get current gesture score (0 or 1) */
    getGestureScore() {
        return this.gestureScore;
    }

    /** Release resources */
    stop() {
        if (this.handLandmarker) {
            this.handLandmarker.close();
            this.handLandmarker = null;
        }
        this.isInitialized = false;
        this.isInitializing = false;
        this._resetFist();
        this.lastLandmarks = null;
        console.log('🛑 Gesture pipeline stopped');
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let pipelineInstance = null;

export const getGesturePipeline = () => {
    if (!pipelineInstance) {
        pipelineInstance = new GesturePipelineController();
    }
    return pipelineInstance;
};

export const resetGesturePipeline = () => {
    if (pipelineInstance) {
        pipelineInstance.stop();
    }
    pipelineInstance = null;
};
