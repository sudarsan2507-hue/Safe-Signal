import { useRef, useEffect, useState } from 'react';
import { getGesturePipeline, resetGesturePipeline } from '../utils/gesturePipeline';
import './GestureDetector.css';

/**
 * Live camera view with a hand-landmark overlay.
 *
 * The setup effect deliberately runs exactly once. Previously it depended on a
 * callback recreated on every parent render, so the camera was torn down and
 * restarted roughly once a second — which also reset the two-second hold timer
 * before it could ever complete. The parent's callback is kept in a ref so it
 * can change freely without restarting the camera.
 *
 * Props:
 *   onGestureUpdate({ gestureScore, confidence, isFist, holdProgress, tracking })
 *   onStatusChange(status)
 */
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
];

/** Only tell the parent when something meaningfully changed. */
const CONFIDENCE_EPSILON = 0.05;
const PROGRESS_EPSILON = 0.05;

const GestureDetector = ({ onGestureUpdate, onStatusChange }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const animFrameRef = useRef(null);
    const streamRef = useRef(null);
    const pipelineRef = useRef(null);

    const onGestureUpdateRef = useRef(onGestureUpdate);
    const onStatusChangeRef = useRef(onStatusChange);
    const lastSentRef = useRef({ gestureScore: -1, confidence: -1, holdProgress: -1, isFist: null });

    const [status, setStatus] = useState('starting');
    const [errorMessage, setErrorMessage] = useState('');
    const [gestureState, setGestureState] = useState({
        isFist: false,
        confidence: 0,
        holdProgress: 0,
        gestureScore: 0,
        tracking: false,
    });

    // Keep the refs current without making the camera effect depend on them.
    useEffect(() => {
        onGestureUpdateRef.current = onGestureUpdate;
        onStatusChangeRef.current = onStatusChange;
    });

    useEffect(() => {
        onStatusChangeRef.current?.(status);
    }, [status]);

    useEffect(() => {
        let cancelled = false;

        const drawLandmarks = (ctx, landmarks, width, height, isFist) => {
            ctx.clearRect(0, 0, width, height);
            if (!landmarks) return;

            const strokeColor = isFist ? '#f2764f' : '#4fb3a4';
            const dotColor = isFist ? '#ffd7c4' : '#b8e6de';

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.globalAlpha = 0.9;
            for (const [a, b] of HAND_CONNECTIONS) {
                ctx.beginPath();
                ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
                ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            ctx.fillStyle = dotColor;
            for (const lm of landmarks) {
                ctx.beginPath();
                ctx.arc(lm.x * width, lm.y * height, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        const emitIfChanged = (result) => {
            const last = lastSentRef.current;
            const changed =
                result.gestureScore !== last.gestureScore ||
                result.isFist !== last.isFist ||
                Math.abs(result.confidence - last.confidence) >= CONFIDENCE_EPSILON ||
                Math.abs(result.holdProgress - last.holdProgress) >= PROGRESS_EPSILON;

            if (!changed) return;

            lastSentRef.current = {
                gestureScore: result.gestureScore,
                confidence: result.confidence,
                holdProgress: result.holdProgress,
                isFist: result.isFist,
            };
            setGestureState({
                isFist: result.isFist,
                confidence: result.confidence,
                holdProgress: result.holdProgress,
                gestureScore: result.gestureScore,
                tracking: result.tracking,
            });
            onGestureUpdateRef.current?.(result);
        };

        const loop = () => {
            if (cancelled) return;

            const video = videoRef.current;
            const canvas = canvasRef.current;
            const pipeline = pipelineRef.current;

            if (video && canvas && pipeline) {
                const result = pipeline.detectFrame(video);
                const ctx = canvas.getContext('2d');
                if (ctx) drawLandmarks(ctx, result.landmarks, canvas.width, canvas.height, result.isFist);
                emitIfChanged(result);
            }

            animFrameRef.current = requestAnimationFrame(loop);
        };

        const start = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('This browser cannot use the camera.');
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, facingMode: 'user' },
                    audio: false,
                });

                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }

                streamRef.current = stream;
                const video = videoRef.current;
                if (!video) return;

                video.srcObject = stream;
                await video.play();

                const canvas = canvasRef.current;
                if (canvas) {
                    canvas.width = video.videoWidth || 640;
                    canvas.height = video.videoHeight || 480;
                }

                setStatus('loading-model');

                const pipeline = getGesturePipeline();
                pipelineRef.current = pipeline;
                await pipeline.init();

                if (cancelled) return;

                setStatus('ready');
                animFrameRef.current = requestAnimationFrame(loop);
            } catch (err) {
                if (cancelled) return;
                setStatus('error');
                setErrorMessage(
                    err?.name === 'NotAllowedError'
                        ? 'Camera permission is turned off.'
                        : err?.message || 'The camera could not be started.',
                );
            }
        };

        start();

        return () => {
            cancelled = true;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            resetGesturePipeline();
            pipelineRef.current = null;
        };
        // Intentionally mount-once: restarting the camera on prop changes is
        // what previously prevented the hold timer from ever completing.
    }, []);

    const { isFist, confidence, holdProgress, tracking } = gestureState;
    const holdSeconds = (holdProgress * 2).toFixed(1);

    return (
        <section className="gesture-detector" aria-labelledby="gesture-heading">
            <header className="gesture-header">
                <h3 id="gesture-heading">Hand signal</h3>
                <p className="gesture-hint">
                    Make a closed fist and hold it for 2 seconds.
                </p>
            </header>

            <div className="gesture-video-container">
                {(status === 'starting' || status === 'loading-model') && (
                    <div className="gesture-overlay" role="status">
                        <span className="gesture-spinner" aria-hidden="true" />
                        <p>{status === 'starting' ? 'Turning on the camera…' : 'Getting ready…'}</p>
                    </div>
                )}

                {status === 'error' && (
                    <div className="gesture-overlay gesture-overlay--error" role="alert">
                        <p className="gesture-error-title">Camera unavailable</p>
                        <p className="gesture-error-detail">{errorMessage}</p>
                        <p className="gesture-error-detail">
                            The other sensors keep working without it.
                        </p>
                    </div>
                )}

                <video
                    ref={videoRef}
                    className="gesture-video"
                    playsInline
                    muted
                    aria-label="Live camera preview used for hand-signal detection"
                    style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
                />
                <canvas
                    ref={canvasRef}
                    className="gesture-canvas"
                    aria-hidden="true"
                    style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
                />

                {status === 'ready' && (
                    <p className={`gesture-badge ${isFist ? 'is-signalled' : ''}`} role="status">
                        {isFist
                            ? 'Signal confirmed'
                            : tracking
                                ? 'Hand detected'
                                : 'No hand in view'}
                    </p>
                )}
            </div>

            {status === 'ready' && (
                <div className="gesture-bars">
                    <div className="gesture-bar-row">
                        <span className="gesture-bar-label" id="fist-confidence-label">
                            Fist shape
                        </span>
                        <div
                            className="gesture-bar-track"
                            role="progressbar"
                            aria-labelledby="fist-confidence-label"
                            aria-valuenow={Math.round(confidence * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                        >
                            <div className="gesture-bar-fill" style={{ width: `${confidence * 100}%` }} />
                        </div>
                        <span className="gesture-bar-value">{Math.round(confidence * 100)}%</span>
                    </div>

                    <div className="gesture-bar-row">
                        <span className="gesture-bar-label" id="hold-progress-label">
                            Held for
                        </span>
                        <div
                            className="gesture-bar-track"
                            role="progressbar"
                            aria-labelledby="hold-progress-label"
                            aria-valuenow={Number(holdSeconds)}
                            aria-valuemin={0}
                            aria-valuemax={2}
                            aria-valuetext={`${holdSeconds} of 2 seconds`}
                        >
                            <div
                                className={`gesture-bar-fill gesture-bar-fill--hold ${isFist ? 'is-complete' : ''}`}
                                style={{ width: `${holdProgress * 100}%` }}
                            />
                        </div>
                        <span className="gesture-bar-value">{isFist ? '2.0s' : `${holdSeconds}s`}</span>
                    </div>
                </div>
            )}

            <p className="gesture-privacy">
                Video is analysed on your device and never uploaded or saved.
            </p>
        </section>
    );
};

export default GestureDetector;
