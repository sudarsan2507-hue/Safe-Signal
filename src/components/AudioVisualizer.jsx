import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import './AudioVisualizer.css';

/**
 * Audio Visualization Dashboard
 * Displays 4 real-time visualizations:
 * 1. Waveform (time vs amplitude)
 * 2. Frequency Spectrum (FFT)
 * 3. MFCC Heatmap
 * 4. Stress Meter
 */

const AudioVisualizer = ({ analyser, stressScore, mfccData, audioRiskWeight, isCalibrating, baseline }) => {
    const waveformCanvasRef = useRef(null);
    const spectrumCanvasRef = useRef(null);
    const mfccCanvasRef = useRef(null);
    const animationFrameRef = useRef(null);

    const [stressLevel, setStressLevel] = useState('LOW');

    useEffect(() => {
        // Update stress level
        if (stressScore < 0.3) setStressLevel('LOW');
        else if (stressScore < 0.75) setStressLevel('MEDIUM');
        else setStressLevel('HIGH');
    }, [stressScore]);

    useEffect(() => {
        if (!analyser) return;

        const drawVisualizations = () => {
            drawWaveform();
            drawSpectrum();
            drawMFCCHeatmap();
            animationFrameRef.current = requestAnimationFrame(drawVisualizations);
        };

        drawVisualizations();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [analyser, mfccData]);

    // === 1. WAVEFORM VISUALIZATION ===
    const drawWaveform = () => {
        const canvas = waveformCanvasRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        // Clear canvas
        ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Draw waveform
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#3b82f6';
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw center line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
    };

    // === 2. FREQUENCY SPECTRUM VISUALIZATION ===
    const drawSpectrum = () => {
        const canvas = spectrumCanvasRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Clear canvas
        ctx.fillStyle = 'rgba(15, 23, 42, 0.3)';
        ctx.fillRect(0, 0, width, height);

        // Draw spectrum bars
        const barWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;

            // Rainbow gradient
            const hue = (i / bufferLength) * 360;
            ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth;
        }
    };

    // === 3. MFCC HEATMAP VISUALIZATION ===
    const drawMFCCHeatmap = () => {
        const canvas = mfccCanvasRef.current;
        if (!canvas || !mfccData || mfccData.length === 0) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = 'rgba(15, 23, 42, 1)';
        ctx.fillRect(0, 0, width, height);

        const numFrames = Math.min(mfccData.length, 80); // Last 80 frames
        const numCoeffs = mfccData[0] ? mfccData[0].length : 40;

        const cellWidth = width / numFrames;
        const cellHeight = height / numCoeffs;

        // Find min/max for normalization
        let min = Infinity;
        let max = -Infinity;
        for (let frame of mfccData.slice(-numFrames)) {
            for (let coeff of frame) {
                min = Math.min(min, coeff);
                max = Math.max(max, coeff);
            }
        }

        // Draw heatmap
        const startFrame = Math.max(0, mfccData.length - numFrames);
        for (let t = 0; t < numFrames; t++) {
            const frame = mfccData[startFrame + t];
            if (!frame) continue;

            for (let c = 0; c < numCoeffs; c++) {
                const value = (frame[c] - min) / (max - min || 1);

                // Viridis colormap approximation
                const color = viridisColor(value);
                ctx.fillStyle = color;

                ctx.fillRect(
                    t * cellWidth,
                    c * cellHeight,
                    cellWidth,
                    cellHeight
                );
            }
        }
    };

    // Viridis colormap (blue → green → yellow)
    const viridisColor = (t) => {
        t = Math.max(0, Math.min(1, t));
        const r = Math.floor(68 + t * (253 - 68));
        const g = Math.floor(1 + t * (231 - 1));
        const b = Math.floor(84 - t * 84);
        return `rgb(${r}, ${g}, ${b})`;
    };

    // === 4. STRESS METER (Radial Gauge) ===
    const StressMeter = () => {
        // During calibration, show a pulsing "Calibrating…" overlay
        if (isCalibrating) {
            return (
                <div className="stress-meter calibrating">
                    <div className="calibrating-badge">
                        <span className="calibrating-spinner">⏳</span>
                        <span className="calibrating-text">Calibrating…</span>
                        <p className="calibrating-sub">Measuring your voice baseline</p>
                    </div>
                </div>
            );
        }

        const percentage = stressScore * 100;
        const rotation = (percentage / 100) * 180 - 90; // -90 to 90 degrees

        const getColor = () => {
            if (stressLevel === 'LOW') return '#10b981';
            if (stressLevel === 'MEDIUM') return '#f59e0b';
            return '#ef4444';
        };

        return (
            <div className="stress-meter">
                <svg viewBox="0 0 200 120" className="meter-svg">
                    {/* Background arc */}
                    <path
                        d="M 20 100 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth="20"
                        strokeLinecap="round"
                    />

                    {/* Progress arc */}
                    <path
                        d="M 20 100 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke={getColor()}
                        strokeWidth="20"
                        strokeLinecap="round"
                        strokeDasharray={`${(percentage / 100) * 251} 251`}
                    />

                    {/* Needle */}
                    <g transform="translate(100, 100)">
                        <line
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="-60"
                            stroke={getColor()}
                            strokeWidth="3"
                            strokeLinecap="round"
                            transform={`rotate(${rotation})`}
                            style={{ transition: 'transform 0.5s ease' }}
                        />
                        <circle cx="0" cy="0" r="6" fill={getColor()} />
                    </g>

                    {/* Labels */}
                    <text x="30" y="110" fill="#10b981" fontSize="12">LOW</text>
                    <text x="82" y="25" fill="#f59e0b" fontSize="12">MED</text>
                    <text x="155" y="110" fill="#ef4444" fontSize="12">HIGH</text>
                </svg>

                <div className="meter-value">
                    <div className="stress-percentage">{percentage.toFixed(0)}%</div>
                    <div className="stress-label">{stressLevel}</div>
                </div>
            </div>
        );
    };

    // === 5. BASELINE DEBUG PANEL ===
    const BaselineDebug = () => {
        if (!baseline) return null;
        return (
            <div className="baseline-debug">
                <span className="baseline-title">📊 Baseline</span>
                <span>F0: {baseline.pitch.toFixed(1)} Hz</span>
                <span>RMS: {baseline.rms.toFixed(4)}</span>
                <span>Centroid: {baseline.centroid.toFixed(0)} Hz</span>
            </div>
        );
    };

    return (
        <div className="audio-visualizer">
            {/* Header */}
            <div className="visualizer-header">
                <h3>🎤 Audio Stress Analysis</h3>
                <div className="risk-weight">
                    {isCalibrating
                        ? '⏳ Calibrating baseline…'
                        : `Audio Weight: 0.3 × ${stressScore.toFixed(2)} = ${audioRiskWeight.toFixed(3)}`
                    }
                </div>
            </div>

            {/* Visualization Grid */}
            <div className="viz-grid">
                {/* Waveform */}
                <div className="viz-panel">
                    <div className="viz-title">Live Waveform</div>
                    <canvas
                        ref={waveformCanvasRef}
                        width={400}
                        height={100}
                        className="viz-canvas"
                    />
                </div>

                {/* Frequency Spectrum */}
                <div className="viz-panel">
                    <div className="viz-title">Frequency Spectrum</div>
                    <canvas
                        ref={spectrumCanvasRef}
                        width={400}
                        height={100}
                        className="viz-canvas"
                    />
                </div>

                {/* MFCC Heatmap */}
                <div className="viz-panel viz-panel-wide">
                    <div className="viz-title">MFCC Heatmap</div>
                    <canvas
                        ref={mfccCanvasRef}
                        width={600}
                        height={200}
                        className="viz-canvas"
                    />
                </div>

                {/* Stress Meter */}
                <div className="viz-panel">
                    <div className="viz-title">Stress Probability</div>
                    <StressMeter />
                    <BaselineDebug />
                </div>
            </div>
        </div>
    );
};

export default AudioVisualizer;
