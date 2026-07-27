import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    RiskTracker,
    getRiskLevel,
    getRiskLabel,
    getRiskDescription,
} from '../utils/riskEngine';
import { getCurrentLocation, watchLocation } from '../utils/geo';
import { getAudioPipeline } from '../utils/audio/audioPipeline';
import { getMotionPipeline, MotionPipelineController } from '../utils/motionPipeline';
import { createAlert } from '../utils/alerts';
import { loadContacts } from '../utils/storage';
import useWakeLock from '../hooks/useWakeLock';
import AudioVisualizer from './AudioVisualizer';
import GestureDetector from './GestureDetector';
import './Dashboard.css';

/** How often risk is recomputed. */
const TICK_MS = 1000;

/** Seconds the user has to stop an alert before it is prepared. */
const COUNTDOWN_SECONDS = 10;

const IDLE_RISK = {
    score: 0,
    level: 'safe',
    coverage: 0,
    activeSensors: [],
    contributions: {},
    sustainProgress: 0,
    escalationReason: null,
};

const IDLE_AUDIO = {
    stressScore: 0,
    isCalibrating: false,
    analyser: null,
    mfccData: [],
    baseline: null,
    ready: false,
    error: null,
};

const IDLE_MOTION = { score: 0, available: false, permissionState: 'unknown' };

const IDLE_GESTURE = { score: 0, confidence: 0, ready: false };

const Dashboard = () => {
    const navigate = useNavigate();

    const [isProtectionOn, setIsProtectionOn] = useState(false);
    const [cameraEnabled, setCameraEnabled] = useState(false);
    const [micEnabled, setMicEnabled] = useState(false);

    const [risk, setRisk] = useState(IDLE_RISK);

    const [countdown, setCountdown] = useState(null);
    const [showTechnical, setShowTechnical] = useState(false);
    const [notice, setNotice] = useState(null);

    const [audio, setAudio] = useState(IDLE_AUDIO);
    const [motion, setMotion] = useState(IDLE_MOTION);
    const [gesture, setGesture] = useState(IDLE_GESTURE);
    const [location, setLocation] = useState({ coords: null, error: null });

    // Sensor values are read inside a 1s interval. Holding them in refs keeps
    // that interval out of the effect's dependency list — when it depended on
    // the audio score, the effect re-ran twice a second and cleared the
    // interval before it could ever tick.
    const gestureRef = useRef(0);
    const stressRef = useRef(0);
    const motionRef = useRef(0);
    const availabilityRef = useRef({ gesture: false, stress: false, motion: false });
    const locationRef = useRef({ coords: null, error: null });
    const trackerRef = useRef(new RiskTracker());
    const tickRef = useRef(null);
    const escalatedRef = useRef(false);

    const wakeLock = useWakeLock(isProtectionOn);
    const contacts = useMemo(() => loadContacts(), []);

    const availability = useMemo(
        () => ({
            gesture: cameraEnabled && gesture.ready,
            stress: micEnabled && audio.ready && !audio.isCalibrating,
            motion: motion.available,
        }),
        [cameraEnabled, gesture.ready, micEnabled, audio.ready, audio.isCalibrating, motion.available],
    );

    // Mirrored into refs so the 1s risk loop can read the latest values
    // without the effect that owns the interval depending on them.
    useEffect(() => {
        availabilityRef.current = availability;
    }, [availability]);

    useEffect(() => {
        locationRef.current = location;
    }, [location]);

    // ── Audio ──────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!isProtectionOn || !micEnabled) {
            getAudioPipeline().stop();
            stressRef.current = 0;
            return undefined;
        }

        const pipeline = getAudioPipeline();
        let cancelled = false;

        pipeline
            .start((update) => {
                if (cancelled) return;
                stressRef.current = update.isCalibrating ? 0 : update.stressScore;
                setAudio({
                    stressScore: update.stressScore,
                    isCalibrating: update.isCalibrating,
                    analyser: update.analyser,
                    mfccData: update.mfccData,
                    baseline: update.baseline,
                    ready: true,
                    error: update.error ?? null,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                setMicEnabled(false);
                setAudio((prev) => ({ ...prev, ready: false, error: error.message }));
                setNotice({ tone: 'warning', text: error.message });
            });

        return () => {
            cancelled = true;
            pipeline.stop();
            stressRef.current = 0;
        };
    }, [isProtectionOn, micEnabled]);

    // ── Motion ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!isProtectionOn) {
            getMotionPipeline().stop();
            motionRef.current = 0;
            return undefined;
        }

        const pipeline = getMotionPipeline();
        let cancelled = false;

        pipeline.start((update) => {
            if (cancelled) return;
            motionRef.current = update.available ? update.motionScore : 0;
            setMotion({
                score: update.motionScore,
                available: update.available,
                permissionState: update.permissionState,
            });
        });

        return () => {
            cancelled = true;
            pipeline.stop();
            motionRef.current = 0;
        };
    }, [isProtectionOn]);

    // ── Location ───────────────────────────────────────────────────────────
    useEffect(() => {
        if (!isProtectionOn) return undefined;

        // Keep a warm fix so an alert does not wait on a cold GPS lock.
        const stop = watchLocation((result) => {
            setLocation(result.ok ? { coords: result.coords, error: null } : { coords: null, error: result.error });
        });

        return stop;
    }, [isProtectionOn]);

    // ── Risk loop ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!isProtectionOn) {
            trackerRef.current.reset();
            escalatedRef.current = false;
            return undefined;
        }

        const tick = () => {
            const readings = {
                gesture: gestureRef.current,
                stress: stressRef.current,
                motion: motionRef.current,
            };
            const evaluation = trackerRef.current.update(readings, availabilityRef.current);
            setRisk(evaluation);

            if (evaluation.shouldEscalate && !escalatedRef.current) {
                escalatedRef.current = true;
                setCountdown(COUNTDOWN_SECONDS);
            }
        };

        tick();
        tickRef.current = setInterval(tick, TICK_MS);

        return () => {
            clearInterval(tickRef.current);
            tickRef.current = null;
        };
    }, [isProtectionOn]);

    const raiseAlert = useCallback(async (reason) => {
        let coords = locationRef.current.coords;
        let locationError = locationRef.current.error;

        if (!coords) {
            const result = await getCurrentLocation({ timeout: 8000 });
            if (result.ok) {
                coords = result.coords;
                locationError = null;
            } else {
                locationError = result.error;
            }
        }

        createAlert({
            contacts: loadContacts(),
            location: coords,
            locationError,
            reason,
        });

        navigate('/emergency');
    }, [navigate]);

    // ── Countdown ──────────────────────────────────────────────────────────
    // Driven by its own effect rather than from inside a setState updater,
    // which must stay pure and would otherwise fire twice under StrictMode.
    useEffect(() => {
        if (countdown === null) return undefined;

        if (countdown <= 0) {
            raiseAlert(risk.escalationReason ?? 'Manual alert');
            return undefined;
        }

        const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
        return () => clearTimeout(timer);
    }, [countdown, raiseAlert, risk.escalationReason]);

    const cancelCountdown = useCallback(() => {
        setCountdown(null);
        escalatedRef.current = false;
        trackerRef.current.reset();
        setNotice({ tone: 'calm', text: "Alert stopped. You're still protected." });
    }, []);

    /**
     * Turning protection off is a user action, so the state it clears is reset
     * here rather than from inside an effect body.
     */
    const toggleProtection = useCallback(() => {
        setIsProtectionOn((wasOn) => !wasOn);

        if (isProtectionOn) {
            gestureRef.current = 0;
            stressRef.current = 0;
            motionRef.current = 0;
            escalatedRef.current = false;
            trackerRef.current.reset();
            setRisk(IDLE_RISK);
            setAudio(IDLE_AUDIO);
            setMotion(IDLE_MOTION);
            setGesture(IDLE_GESTURE);
            setCountdown(null);
        }
    }, [isProtectionOn]);

    const toggleMic = useCallback(() => {
        setMicEnabled((wasOn) => !wasOn);
        if (micEnabled) {
            stressRef.current = 0;
            setAudio(IDLE_AUDIO);
        }
    }, [micEnabled]);

    const toggleCamera = useCallback(() => {
        setCameraEnabled((wasOn) => !wasOn);
        if (cameraEnabled) {
            gestureRef.current = 0;
            setGesture(IDLE_GESTURE);
        }
    }, [cameraEnabled]);

    const handleGestureUpdate = useCallback((data) => {
        gestureRef.current = data.gestureScore;
        setGesture({ score: data.gestureScore, confidence: data.confidence, ready: true });
    }, []);

    const handleGestureStatus = useCallback((status) => {
        if (status === 'error') {
            setGesture({ score: 0, confidence: 0, ready: false });
            gestureRef.current = 0;
        }
    }, []);

    const activeCount = risk.activeSensors.length;
    const level = isProtectionOn ? getRiskLevel(risk.score) : 'safe';
    const statusLabel = isProtectionOn ? getRiskLabel(level) : 'Protection off';
    const motionSupported = MotionPipelineController.isSupported();

    return (
        <div className="page dashboard">
            <header className="dash-header">
                <div>
                    <p className="dash-eyebrow">SafeSignal</p>
                    <h1 className="dash-title">{statusLabel}</h1>
                </div>
                <button
                    type="button"
                    className="link-button"
                    onClick={() => navigate('/contacts')}
                >
                    Contacts
                </button>
            </header>

            {notice && (
                <div className={`notice notice--${notice.tone}`} role="status">
                    <p>{notice.text}</p>
                    <button type="button" className="notice-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss message">
                        ×
                    </button>
                </div>
            )}

            {/* ── Status ─────────────────────────────────────────────── */}
            <section className={`status-card status-card--${level}`} aria-live="polite">
                <div className="status-ring-wrap">
                    <RiskRing score={risk.score} level={level} active={isProtectionOn} />
                </div>
                <p className="status-description">{getRiskDescription(level, isProtectionOn)}</p>

                {isProtectionOn && risk.sustainProgress > 0 && countdown === null && (
                    <p className="status-sustain" role="status">
                        Confirming for a few seconds before doing anything…
                    </p>
                )}
            </section>

            {/* ── Protection toggle ──────────────────────────────────── */}
            <section className="control-card">
                <div className="control-row">
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={isProtectionOn}
                            onChange={toggleProtection}
                        />
                        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                        <span className="switch-label">
                            {isProtectionOn ? 'Protection is on' : 'Turn on protection'}
                        </span>
                    </label>
                </div>

                {isProtectionOn && (
                    <div className="sensor-toggles">
                        <SensorToggle
                            label="Hand signal"
                            hint="Uses the camera"
                            checked={cameraEnabled}
                            onChange={toggleCamera}
                        />
                        <SensorToggle
                            label="Voice tone"
                            hint="Uses the microphone"
                            checked={micEnabled}
                            onChange={toggleMic}
                        />
                        <SensorToggle
                            label="Movement"
                            hint={motionSupported ? 'Uses motion sensors' : 'Not available on this device'}
                            checked={motion.available}
                            disabled
                            readOnlyReason={
                                motionSupported
                                    ? motion.available
                                        ? 'Active'
                                        : 'Waiting for sensor data'
                                    : 'Unavailable'
                            }
                        />
                    </div>
                )}

                {isProtectionOn && (
                    <p className="coverage-line">
                        {activeCount === 0
                            ? 'No sensors are running yet. Turn one on above so SafeSignal has something to watch.'
                            : `Watching with ${activeCount} of 3 sensors.`}
                    </p>
                )}
            </section>

            {/* ── Sensor panels ──────────────────────────────────────── */}
            {isProtectionOn && cameraEnabled && (
                <GestureDetector
                    onGestureUpdate={handleGestureUpdate}
                    onStatusChange={handleGestureStatus}
                />
            )}

            {isProtectionOn && micEnabled && (
                <AudioVisualizer
                    analyser={audio.analyser}
                    stressScore={audio.stressScore}
                    mfccData={audio.mfccData}
                    isCalibrating={audio.isCalibrating}
                    baseline={audio.baseline}
                    showTechnical={showTechnical}
                />
            )}

            {/* ── Manual alert ───────────────────────────────────────── */}
            <section className="manual-card">
                <button
                    type="button"
                    className="btn-alert"
                    onClick={() => setCountdown(COUNTDOWN_SECONDS)}
                >
                    Get help now
                </button>
                <p className="manual-hint">
                    {contacts.length > 0
                        ? `Prepares a message for your ${contacts.length} contact${contacts.length > 1 ? 's' : ''}. You get ${COUNTDOWN_SECONDS} seconds to stop it.`
                        : 'Add a contact first so there is someone to reach.'}
                </p>
            </section>

            {/* ── Reassurance ────────────────────────────────────────── */}
            <section className="assurance">
                <p>Everything is analysed on this device. No video or audio is uploaded or saved.</p>
                {isProtectionOn && !wakeLock.held && wakeLock.supported && (
                    <p>Keep this screen open — detection pauses if the phone sleeps.</p>
                )}
                {isProtectionOn && !wakeLock.supported && (
                    <p>Keep this screen open and awake — detection only runs while it is visible.</p>
                )}
                {location.error && isProtectionOn && (
                    <p>Location: {location.error} An alert will still be prepared without it.</p>
                )}
            </section>

            <button
                type="button"
                className="link-button link-button--muted"
                onClick={() => setShowTechnical((v) => !v)}
                aria-expanded={showTechnical}
            >
                {showTechnical ? 'Hide technical details' : 'Show technical details'}
            </button>

            {showTechnical && (
                <section className="tech-panel">
                    <h2 className="tech-title">Risk breakdown</h2>
                    {activeCount === 0 ? (
                        <p className="tech-empty">No sensors active.</p>
                    ) : (
                        <table className="tech-table">
                            <thead>
                                <tr>
                                    <th scope="col">Sensor</th>
                                    <th scope="col">Reading</th>
                                    <th scope="col">Weight</th>
                                    <th scope="col">Adds</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(risk.contributions).map(([key, c]) => (
                                    <tr key={key}>
                                        <th scope="row">{key}</th>
                                        <td>{c.value.toFixed(2)}</td>
                                        <td>{c.weight.toFixed(2)}</td>
                                        <td>{c.contribution.toFixed(3)}</td>
                                    </tr>
                                ))}
                                <tr className="tech-total">
                                    <th scope="row">Total</th>
                                    <td colSpan={2}>threshold 0.75</td>
                                    <td>{risk.score.toFixed(3)}</td>
                                </tr>
                            </tbody>
                        </table>
                    )}
                    <p className="tech-note">
                        Weights are shared out across the sensors that are actually running, so a
                        partial setup can still reach the threshold.
                    </p>
                    {audio.error && <p className="tech-error">Audio: {audio.error}</p>}
                </section>
            )}

            {/* ── Countdown ──────────────────────────────────────────── */}
            {countdown !== null && (
                <div className="countdown-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="countdown-title">
                    <div className="countdown-card">
                        <h2 id="countdown-title" className="countdown-title">
                            Getting help ready
                        </h2>
                        <p className="countdown-reason">
                            {risk.escalationReason ?? 'You asked for help.'}
                        </p>
                        <p className="countdown-number" aria-live="assertive">
                            {countdown}
                        </p>
                        <p className="countdown-sub">
                            Your alert will be prepared in {countdown} second{countdown === 1 ? '' : 's'}.
                        </p>
                        <button type="button" className="btn-cancel" onClick={cancelCountdown} autoFocus>
                            I&apos;m okay — stop
                        </button>
                        <p className="countdown-note">Nothing has been sent yet.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * Circular risk indicator. State is conveyed by the label and fill amount as
 * well as colour, so it does not rely on colour vision alone.
 */
const RiskRing = ({ score, level, active }) => {
    const radius = 76;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - (active ? score : 0));

    return (
        <div className="risk-ring">
            <svg viewBox="0 0 180 180" role="img" aria-label={`Risk level ${Math.round(score * 100)} percent`}>
                <circle className="risk-ring-track" cx="90" cy="90" r={radius} />
                <circle
                    className={`risk-ring-fill risk-ring-fill--${level}`}
                    cx="90"
                    cy="90"
                    r={radius}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                />
            </svg>
            <div className="risk-ring-center">
                <span className={`risk-ring-dot risk-ring-dot--${level} ${active ? 'is-active' : ''}`} aria-hidden="true" />
                <span className="risk-ring-value">{active ? `${Math.round(score * 100)}%` : '—'}</span>
                <span className="risk-ring-caption">{active ? 'risk' : 'off'}</span>
            </div>
        </div>
    );
};

const SensorToggle = ({ label, hint, checked, onChange, disabled, readOnlyReason }) => (
    <div className={`sensor-toggle ${disabled ? 'is-disabled' : ''}`}>
        <label className="sensor-toggle-main">
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
            />
            <span className="sensor-toggle-box" aria-hidden="true" />
            <span className="sensor-toggle-text">
                <span className="sensor-toggle-label">{label}</span>
                <span className="sensor-toggle-hint">{readOnlyReason ?? hint}</span>
            </span>
        </label>
    </div>
);

export default Dashboard;
