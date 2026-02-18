import { useRef, useEffect, useState, useCallback } from 'react';
import { getGesturePipeline, resetGesturePipeline } from '../utils/gesturePipeline';
import './GestureDetector.css';

/**
 * GestureDetector Component
 * Renders live camera feed with MediaPipe hand landmark overlay.
 * Detects closed fist held for 2 seconds → gestureScore = 1.
 *
 * Props:
 *   onGestureUpdate({ gestureScore, confidence, isFist, holdProgress })
 */
const GestureDetector = ({ onGestureUpdate }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const animFrameRef = useRef(null);
    const streamRef = useRef(null);
    const pipelineRef = useRef(null);

    const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'error'
    const [gestureState, setGestureState] = useState({
        isFist: false,
        confidence: 0,
        holdProgress: 0,
        gestureScore: 0,
    });

    // ── MediaPipe connection indices for drawing skeleton ──────────────────
    const HAND_CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8],       // Index
        [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17],             // Palm
    ];

    // ── Draw landmarks on canvas ───────────────────────────────────────────
    const drawLandmarks = useCallback((ctx, landmarks, width, height, isFist) => {
        ctx.clearRect(0, 0, width, height);

        if (!landmarks) return;

        const color = isFist ? '#ef4444' : '#10b981';
        const dotColor = isFist ? '#fca5a5' : '#6ee7b7';

        // Draw connections
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;

        for (const [a, b] of HAND_CONNECTIONS) {
            const lA = landmarks[a];
            const lB = landmarks[b];
            ctx.beginPath();
            ctx.moveTo(lA.x * width, lA.y * height);
            ctx.lineTo(lB.x * width, lB.y * height);
            ctx.stroke();
        }

        // Draw landmark dots
        ctx.globalAlpha = 1;
        for (const lm of landmarks) {
            ctx.beginPath();
            ctx.arc(lm.x * width, lm.y * height, 4, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.fill();
        }
    }, []);

    // ── Main detection loop ────────────────────────────────────────────────
    const runDetectionLoop = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const pipeline = pipelineRef.current;

        if (!video || !canvas || !pipeline) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const result = pipeline.detectFrame(video);

        drawLandmarks(ctx, result.landmarks, width, height, result.isFist);

        setGestureState({
            isFist: result.isFist,
            confidence: result.confidence,
            holdProgress: result.holdProgress || 0,
            gestureScore: result.gestureScore,
        });

        if (onGestureUpdate) {
            onGestureUpdate(result);
        }

        animFrameRef.current = requestAnimationFrame(runDetectionLoop);
    }, [drawLandmarks, onGestureUpdate]);

    // ── Initialize camera + pipeline ───────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const init = async () => {
            try {
                // Get camera stream
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, facingMode: 'user' },
                    audio: false,
                });

                if (cancelled) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }

                streamRef.current = stream;
                const video = videoRef.current;
                video.srcObject = stream;
                await video.play();

                // Sync canvas size to video
                const canvas = canvasRef.current;
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;

                // Initialize gesture pipeline
                const pipeline = getGesturePipeline();
                pipelineRef.current = pipeline;
                await pipeline.init();

                if (cancelled) return;

                setStatus('ready');
                animFrameRef.current = requestAnimationFrame(runDetectionLoop);
            } catch (err) {
                console.error('GestureDetector init failed:', err);
                if (!cancelled) setStatus('error');
            }
        };

        init();

        return () => {
            cancelled = true;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            resetGesturePipeline();
        };
    }, [runDetectionLoop]);

    // ── Render ─────────────────────────────────────────────────────────────
    const { isFist, confidence, holdProgress, gestureScore } = gestureState;
    const riskContribution = (gestureScore * 0.5).toFixed(2);

    return (
        <div className="gesture-detector">
            {/* Header */}
            <div className="gesture-header">
                <h3>🤚 Gesture Detection</h3>
                <div className="gesture-contribution">
                    Gesture Weight: 0.5 × {gestureScore} = {riskContribution}
                </div>
            </div>

            {/* Video + Canvas overlay */}
            <div className="gesture-video-container">
                {status === 'initializing' && (
                    <div className="gesture-loading">
                        <span className="gesture-spinner">⏳</span>
                        <p>Loading MediaPipe…</p>
                    </div>
                )}
                {status === 'error' && (
                    <div className="gesture-error">
                        <span>⚠️ Camera unavailable</span>
                        <p>Check camera permissions</p>
                    </div>
                )}
                <video
                    ref={videoRef}
                    className="gesture-video"
                    playsInline
                    muted
                    style={{ display: status === 'ready' ? 'block' : 'none' }}
                />
                <canvas
                    ref={canvasRef}
                    className="gesture-canvas"
                    style={{ display: status === 'ready' ? 'block' : 'none' }}
                />

                {/* Gesture label badge */}
                {status === 'ready' && (
                    <div className={`gesture-badge ${isFist ? 'fist' : 'open'}`}>
                        {isFist ? '✊ Gesture Detected' : '🖐 No Gesture'}
                    </div>
                )}
            </div>

            {/* Confidence + Hold Progress bars */}
            {status === 'ready' && (
                <div className="gesture-bars">
                    <div className="gesture-bar-row">
                        <span className="gesture-bar-label">Fist Confidence</span>
                        <div className="gesture-bar-track">
                            <div
                                className="gesture-bar-fill confidence"
                                style={{ width: `${confidence * 100}%` }}
                            />
                        </div>
                        <span className="gesture-bar-value">{Math.round(confidence * 100)}%</span>
                    </div>

                    <div className="gesture-bar-row">
                        <span className="gesture-bar-label">Hold Progress</span>
                        <div className="gesture-bar-track">
                            <div
                                className={`gesture-bar-fill hold ${isFist ? 'complete' : ''}`}
                                style={{ width: `${holdProgress * 100}%` }}
                            />
                        </div>
                        <span className="gesture-bar-value">
                            {isFist ? '✓ 2s' : `${(holdProgress * 2).toFixed(1)}s`}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GestureDetector;
