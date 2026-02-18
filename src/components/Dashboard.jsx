import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    calculateRisk,
    detectGesture,
    detectStress,
    detectMotion,
    getRiskLevel,
    getRiskColor,
    triggerEmergency,
} from '../utils/riskEngine';
import { getCurrentLocation, getMockLocation } from '../utils/geo';
import { getAudioPipeline } from '../utils/audio/audioPipeline';
import AudioVisualizer from './AudioVisualizer';
import GestureDetector from './GestureDetector';
import './Dashboard.css';

const Dashboard = () => {
    const navigate = useNavigate();
    const [isProtectionOn, setIsProtectionOn] = useState(false);
    const [riskScore, setRiskScore] = useState(0);
    const [riskLevel, setRiskLevel] = useState('safe');
    const [showPreAlert, setShowPreAlert] = useState(false);
    const [countdown, setCountdown] = useState(5);

    // Audio stress detection state
    const [audioStressScore, setAudioStressScore] = useState(0);
    const [audioRiskWeight, setAudioRiskWeight] = useState(0);
    const [mfccData, setMFCCData] = useState([]);
    const [analyser, setAnalyser] = useState(null);
    const [audioEnabled, setAudioEnabled] = useState(false);
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [audioBaseline, setAudioBaseline] = useState(null);

    // Gesture detection state
    const [gestureEnabled, setGestureEnabled] = useState(false);
    const [gestureScore, setGestureScore] = useState(0);
    const [gestureConfidence, setGestureConfidence] = useState(0);
    const [gestureIsFist, setGestureIsFist] = useState(false);
    const gestureScoreRef = useRef(0); // Ref for use inside setInterval

    // Motion state (for debug panel)
    const [lastMotionScore, setLastMotionScore] = useState(0);
    const [lastGestureInRisk, setLastGestureInRisk] = useState(0);

    const detectionIntervalRef = useRef(null);
    const highRiskTimerRef = useRef(null);
    const countdownIntervalRef = useRef(null);
    const audioPipelineRef = useRef(null);

    // Start/Stop Audio Pipeline
    useEffect(() => {
        if (isProtectionOn && audioEnabled) {
            // Start audio pipeline
            const pipeline = getAudioPipeline();
            audioPipelineRef.current = pipeline;

            pipeline.start((audioData) => {
                setAudioStressScore(audioData.stressScore);
                setAudioRiskWeight(audioData.audioRiskWeight);
                setMFCCData(audioData.mfccData);
                setAnalyser(audioData.analyser);
                setIsCalibrating(audioData.isCalibrating);
                setAudioBaseline(audioData.baseline);
            }).catch((error) => {
                console.error('Audio pipeline failed:', error);
                setAudioEnabled(false);
            });
        } else {
            // Stop audio pipeline
            if (audioPipelineRef.current) {
                audioPipelineRef.current.stop();
                audioPipelineRef.current = null;
            }
            setAudioStressScore(0);
            setAudioRiskWeight(0);
            setIsCalibrating(false);
            setAudioBaseline(null);
        }

        return () => {
            if (audioPipelineRef.current) {
                audioPipelineRef.current.stop();
            }
        };
    }, [isProtectionOn, audioEnabled]);

    // Start/Stop Protection Detection Loop
    useEffect(() => {
        if (isProtectionOn) {
            // Start detection loop
            detectionIntervalRef.current = setInterval(() => {
                const gesture = gestureScoreRef.current; // Real gesture score
                const motion = detectMotion();

                // Use real audio stress if available, otherwise mock
                const stress = audioEnabled ? audioStressScore : detectStress();

                const risk = calculateRisk(gesture, stress, motion);
                setRiskScore(risk);
                setRiskLevel(getRiskLevel(risk));

                // Track components for debug panel
                setLastMotionScore(motion);
                setLastGestureInRisk(gesture);

                // Check threshold
                if (risk > 0.75) {
                    if (!highRiskTimerRef.current) {
                        // Start 5-second timer
                        highRiskTimerRef.current = setTimeout(() => {
                            setShowPreAlert(true);
                            startCountdown();
                        }, 5000);
                    }
                } else {
                    // Reset timer if risk drops
                    if (highRiskTimerRef.current) {
                        clearTimeout(highRiskTimerRef.current);
                        highRiskTimerRef.current = null;
                    }
                }
            }, 1000); // Check every second
        } else {
            // Clear intervals
            if (detectionIntervalRef.current) {
                clearInterval(detectionIntervalRef.current);
            }
            if (highRiskTimerRef.current) {
                clearTimeout(highRiskTimerRef.current);
                highRiskTimerRef.current = null;
            }
            setRiskScore(0);
            setRiskLevel('safe');
        }

        return () => {
            if (detectionIntervalRef.current) {
                clearInterval(detectionIntervalRef.current);
            }
            if (highRiskTimerRef.current) {
                clearTimeout(highRiskTimerRef.current);
            }
        };
    }, [isProtectionOn, audioStressScore, audioEnabled]);

    // Countdown for pre-alert
    const startCountdown = () => {
        setCountdown(5);
        countdownIntervalRef.current = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(countdownIntervalRef.current);
                    handleEmergency();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    // Cancel Alert
    const cancelAlert = () => {
        setShowPreAlert(false);
        setCountdown(5);
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
        }
        if (highRiskTimerRef.current) {
            clearTimeout(highRiskTimerRef.current);
            highRiskTimerRef.current = null;
        }
    };

    // Trigger Emergency
    const handleEmergency = async () => {
        try {
            const contacts = JSON.parse(localStorage.getItem('emergencyContacts') || '[]');
            let location;

            try {
                location = await getCurrentLocation();
            } catch {
                location = getMockLocation();
            }

            await triggerEmergency(contacts, location);
            navigate('/emergency');
        } catch (error) {
            console.error('Emergency trigger failed:', error);
        }
    };

    // Manual Panic
    const handleManualPanic = () => {
        setShowPreAlert(true);
        startCountdown();
    };

    return (
        <div className="page dashboard-screen">
            <motion.div
                className="dashboard-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6 }}
            >
                {/* Header */}
                <div className="dashboard-header">
                    <h2>SafeSignal</h2>
                    <div className="header-controls">
                        <button
                            className={`audio-toggle-btn ${audioEnabled ? 'active' : ''}`}
                            onClick={() => setAudioEnabled(!audioEnabled)}
                            title="Toggle Audio Detection"
                        >
                            {audioEnabled ? '🎤' : '🔇'}
                        </button>
                        <button
                            className={`audio-toggle-btn ${gestureEnabled ? 'active gesture-active' : ''}`}
                            onClick={() => setGestureEnabled(!gestureEnabled)}
                            title="Toggle Gesture Detection"
                        >
                            {gestureEnabled ? '📷' : '🚫'}
                        </button>
                        <button className="settings-btn" onClick={() => alert('Settings coming soon!')}>
                            ⚙️
                        </button>
                    </div>
                </div>

                {/* Audio Visualizer */}
                {audioEnabled && isProtectionOn && analyser && (
                    <AudioVisualizer
                        analyser={analyser}
                        stressScore={audioStressScore}
                        mfccData={mfccData}
                        audioRiskWeight={audioRiskWeight}
                        isCalibrating={isCalibrating}
                        baseline={audioBaseline}
                    />
                )}

                {/* Gesture Detector */}
                {gestureEnabled && isProtectionOn && (
                    <GestureDetector
                        onGestureUpdate={(data) => {
                            setGestureScore(data.gestureScore);
                            setGestureConfidence(data.confidence);
                            setGestureIsFist(data.isFist);
                            gestureScoreRef.current = data.gestureScore;
                        }}
                    />
                )}

                {/* Status Circle */}
                <motion.div
                    className={`status-circle ${riskLevel}`}
                    style={{ borderColor: getRiskColor(riskLevel) }}
                    animate={{ scale: isProtectionOn ? [1, 1.05, 1] : 1 }}
                    transition={{ repeat: Infinity, duration: 2 }}
                >
                    <div className="status-icon">
                        {isProtectionOn ? '🛡️' : '🔒'}
                    </div>
                    <div className="status-text">
                        {isProtectionOn ? getRiskLevel(riskScore).toUpperCase() : 'OFFLINE'}
                    </div>
                </motion.div>

                {/* Risk Meter */}
                {isProtectionOn && (
                    <motion.div
                        className="risk-meter"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        <p className="risk-label">Risk Level</p>
                        <div className="risk-bar-container">
                            <motion.div
                                className="risk-bar"
                                style={{
                                    width: `${riskScore * 100}%`,
                                    backgroundColor: getRiskColor(riskLevel),
                                }}
                                animate={{ width: `${riskScore * 100}%` }}
                                transition={{ duration: 0.5 }}
                            />
                        </div>
                        <p className="risk-value">{Math.round(riskScore * 100)}%</p>

                        {/* Debug Risk Panel */}
                        <div className="risk-debug-panel">
                            <div className="risk-debug-title">📊 Risk Components</div>
                            <div className="risk-debug-row">
                                <span>🤚 Gesture</span>
                                <span>{lastGestureInRisk} × 0.5</span>
                                <span className="risk-debug-contrib">{(lastGestureInRisk * 0.5).toFixed(2)}</span>
                            </div>
                            <div className="risk-debug-row">
                                <span>🎤 Stress</span>
                                <span>{audioEnabled ? audioStressScore.toFixed(2) : 'mock'} × 0.3</span>
                                <span className="risk-debug-contrib">{(audioEnabled ? audioStressScore * 0.3 : 0.05).toFixed(2)}</span>
                            </div>
                            <div className="risk-debug-row">
                                <span>📱 Motion</span>
                                <span>{lastMotionScore.toFixed(2)} × 0.2</span>
                                <span className="risk-debug-contrib">{(lastMotionScore * 0.2).toFixed(2)}</span>
                            </div>
                            <div className="risk-debug-row risk-debug-total">
                                <span>⚡ Total</span>
                                <span></span>
                                <span className="risk-debug-contrib">{riskScore.toFixed(2)}</span>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Protection Toggle */}
                <div className="protection-toggle">
                    <label className="toggle-switch large">
                        <input
                            type="checkbox"
                            checked={isProtectionOn}
                            onChange={() => setIsProtectionOn(!isProtectionOn)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                    <p className="toggle-label">
                        {isProtectionOn ? 'Protection Active' : 'Protection Inactive'}
                    </p>
                </div>

                {/* Manual Panic Button */}
                <motion.button
                    className="panic-btn"
                    onClick={handleManualPanic}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                >
                    🚨 Manual Alert
                </motion.button>

                {/* Pre-Alert Popup */}
                {showPreAlert && (
                    <motion.div
                        className="pre-alert-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <motion.div
                            className="pre-alert-card"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                        >
                            <h3>⚠️ Unusual Activity Detected</h3>
                            <p className="countdown-text">Alert sending in {countdown}s</p>
                            <button className="btn-danger cancel-btn" onClick={cancelAlert}>
                                Cancel Alert
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </motion.div>
        </div>
    );
};

export default Dashboard;
