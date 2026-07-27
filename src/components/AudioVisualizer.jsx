import { useRef, useEffect, useState } from 'react';
import { getStressLevel, describeStress } from '../utils/audio/stressInference';
import './AudioVisualizer.css';

/**
 * Voice panel.
 *
 * The everyday view is a single calm reading in plain language. Spectrograms
 * and coefficient heatmaps are diagnostics, not reassurance — they live behind
 * the technical-details toggle so the main screen stays readable by someone
 * who is frightened rather than curious.
 */
const AudioVisualizer = ({ analyser, stressScore, mfccData, isCalibrating, baseline, showTechnical }) => {
    const waveCanvasRef = useRef(null);
    const mfccCanvasRef = useRef(null);
    const frameRef = useRef(null);
    const reducedMotion = usePrefersReducedMotion();

    useEffect(() => {
        if (!analyser) return undefined;

        let cancelled = false;

        const draw = () => {
            if (cancelled) return;
            drawWaveform(waveCanvasRef.current, analyser);
            if (showTechnical) drawMFCC(mfccCanvasRef.current, mfccData);
            frameRef.current = requestAnimationFrame(draw);
        };

        // A moving waveform is the point of the waveform; when the user asks
        // for reduced motion we paint once and leave it still.
        if (reducedMotion) {
            drawWaveform(waveCanvasRef.current, analyser);
            if (showTechnical) drawMFCC(mfccCanvasRef.current, mfccData);
        } else {
            draw();
        }

        return () => {
            cancelled = true;
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        };
    }, [analyser, mfccData, showTechnical, reducedMotion]);

    const level = getStressLevel(stressScore);

    return (
        <section className="audio-panel" aria-labelledby="audio-heading">
            <header className="audio-header">
                <h3 id="audio-heading">Voice</h3>
                <p className="audio-hint">
                    {isCalibrating
                        ? 'Learning how you normally sound…'
                        : describeStress(stressScore)}
                </p>
            </header>

            <div className="audio-body">
                <canvas
                    ref={waveCanvasRef}
                    className="audio-wave"
                    width={600}
                    height={90}
                    aria-hidden="true"
                />

                {isCalibrating ? (
                    <p className="audio-calibrating" role="status">
                        This takes about five seconds. If you are not speaking, SafeSignal will pick
                        up your baseline later — protection is already on.
                    </p>
                ) : (
                    <div className="audio-meter">
                        <div
                            className="audio-meter-track"
                            role="progressbar"
                            aria-label="Voice tension"
                            aria-valuenow={Math.round(stressScore * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuetext={describeStress(stressScore)}
                        >
                            <div
                                className={`audio-meter-fill audio-meter-fill--${level}`}
                                style={{ width: `${Math.max(stressScore * 100, 2)}%` }}
                            />
                        </div>
                        <span className="audio-meter-value">{Math.round(stressScore * 100)}%</span>
                    </div>
                )}
            </div>

            {showTechnical && (
                <div className="audio-technical">
                    <p className="audio-tech-title">MFCC over time</p>
                    <canvas ref={mfccCanvasRef} className="audio-mfcc" width={600} height={160} aria-hidden="true" />
                    {baseline ? (
                        <dl className="audio-baseline">
                            <div><dt>Pitch baseline</dt><dd>{baseline.pitch.toFixed(1)} Hz</dd></div>
                            <div><dt>Energy baseline</dt><dd>{baseline.rms.toFixed(4)}</dd></div>
                            <div><dt>Centroid baseline</dt><dd>{baseline.centroid.toFixed(0)} Hz</dd></div>
                        </dl>
                    ) : (
                        <p className="audio-tech-note">
                            No personal baseline yet — scoring against absolute thresholds until
                            enough speech is heard.
                        </p>
                    )}
                </div>
            )}

            <p className="audio-privacy">Audio is analysed on your device and never uploaded or saved.</p>
        </section>
    );
};

/**
 * @param {HTMLCanvasElement|null} canvas
 * @param {AnalyserNode} analyser
 */
const drawWaveform = (canvas, analyser) => {
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const buffer = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buffer);

    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    ctx.strokeStyle = styles.getPropertyValue('--wave-color').trim() || '#4fb3a4';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    // The buffer is far wider than the canvas; step through it so the whole
    // window is represented rather than only its first pixels' worth.
    const step = Math.max(1, Math.floor(buffer.length / width));
    let x = 0;
    for (let i = 0; i < buffer.length; i += step) {
        const v = buffer[i] / 128 - 1;
        const y = height / 2 + v * (height / 2) * 0.9;
        if (x === 0) ctx.moveTo(0, y);
        else ctx.lineTo(x, y);
        x += 1;
    }
    ctx.stroke();
};

/**
 * @param {HTMLCanvasElement|null} canvas
 * @param {number[][]} mfccData
 */
const drawMFCC = (canvas, mfccData) => {
    if (!canvas || !mfccData || mfccData.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const frames = mfccData.slice(-80);
    const numCoeffs = frames[0]?.length ?? 0;
    if (numCoeffs === 0) return;

    let min = Infinity;
    let max = -Infinity;
    for (const frame of frames) {
        for (const coeff of frame) {
            if (coeff < min) min = coeff;
            if (coeff > max) max = coeff;
        }
    }
    const range = max - min || 1;

    const cellWidth = width / frames.length;
    const cellHeight = height / numCoeffs;

    for (let t = 0; t < frames.length; t++) {
        for (let c = 0; c < numCoeffs; c++) {
            const value = (frames[t][c] - min) / range;
            ctx.fillStyle = heatColor(value);
            ctx.fillRect(t * cellWidth, c * cellHeight, cellWidth + 1, cellHeight + 1);
        }
    }
};

/**
 * Teal-to-amber ramp, chosen to stay legible for common colour-vision
 * differences rather than for decoration.
 * @param {number} t 0–1
 * @returns {string}
 */
const heatColor = (t) => {
    const clamped = Math.max(0, Math.min(1, t));
    const r = Math.round(24 + clamped * 219);
    const g = Math.round(72 + clamped * 108);
    const b = Math.round(94 - clamped * 34);
    return `rgb(${r}, ${g}, ${b})`;
};

/**
 * @returns {boolean} whether the user asked for reduced motion
 */
const usePrefersReducedMotion = () => {
    const [reduced, setReduced] = useState(
        () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    );

    useEffect(() => {
        const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!query) return undefined;

        const handler = (event) => setReduced(event.matches);
        query.addEventListener('change', handler);
        return () => query.removeEventListener('change', handler);
    }, []);

    return reduced;
};

export default AudioVisualizer;
