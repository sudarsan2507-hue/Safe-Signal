import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadPermissions, savePermissions } from '../utils/storage';
import { MotionPipelineController } from '../utils/motionPipeline';
import './PermissionScreen.css';

/**
 * Permission onboarding.
 *
 * Each row triggers the real browser prompt and then shows what was actually
 * granted. The previous version let a toggle look "on" whether or not the user
 * had allowed anything, which meant the app could present itself as fully
 * equipped while holding no permissions at all.
 *
 * Every permission is optional. SafeSignal degrades to whatever is allowed and
 * says so, rather than blocking the user at the door.
 */

/** @typedef {'idle'|'requesting'|'granted'|'denied'|'unsupported'} PermState */

const PermissionScreen = () => {
    const navigate = useNavigate();

    const [states, setStates] = useState(() => {
        const stored = loadPermissions();
        const motionSupported = MotionPipelineController.isSupported();
        return {
            camera: stored.camera ? 'granted' : 'idle',
            microphone: stored.microphone ? 'granted' : 'idle',
            location: stored.location ? 'granted' : 'idle',
            motion: !motionSupported ? 'unsupported' : stored.motion ? 'granted' : 'idle',
        };
    });

    /**
     * @param {string} key
     * @param {PermState} value
     */
    const setState = (key, value) => {
        setStates((prev) => {
            const next = { ...prev, [key]: value };
            savePermissions({
                camera: next.camera === 'granted',
                microphone: next.microphone === 'granted',
                location: next.location === 'granted',
                motion: next.motion === 'granted',
            });
            return next;
        });
    };

    /**
     * Request one permission and record the real outcome.
     * @param {'camera'|'microphone'|'location'|'motion'} key
     */
    const request = async (key) => {
        setState(key, 'requesting');

        try {
            if (key === 'camera' || key === 'microphone') {
                if (!navigator.mediaDevices?.getUserMedia) {
                    setState(key, 'unsupported');
                    return;
                }
                const constraints = key === 'camera' ? { video: true } : { audio: true };
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                // Release immediately — this is a permission check, not capture.
                stream.getTracks().forEach((t) => t.stop());
                setState(key, 'granted');
                return;
            }

            if (key === 'location') {
                if (!navigator.geolocation) {
                    setState(key, 'unsupported');
                    return;
                }
                await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
                });
                setState(key, 'granted');
                return;
            }

            if (key === 'motion') {
                const result = await MotionPipelineController.requestPermission();
                setState(key, result === 'granted' ? 'granted' : result === 'unsupported' ? 'unsupported' : 'denied');
            }
        } catch {
            setState(key, 'denied');
        }
    };

    const grantedCount = Object.values(states).filter((s) => s === 'granted').length;

    return (
        <div className="page permission-screen">
            <div className="screen-inner">
                <header className="screen-header">
                    <h1>What may SafeSignal use?</h1>
                    <p className="screen-subtitle">
                        Allow whatever you are comfortable with. Each one is optional, and you can
                        change your mind at any time in your browser settings.
                    </p>
                </header>

                <ul className="permission-list">
                    <PermissionRow
                        title="Camera"
                        purpose="Recognises the hand signal you choose to make."
                        detail="Frames are analysed on your device. Nothing is recorded or uploaded."
                        state={states.camera}
                        onRequest={() => request('camera')}
                    />
                    <PermissionRow
                        title="Microphone"
                        purpose="Listens for tension in your voice."
                        detail="Audio is analysed on your device. Nothing is recorded or uploaded."
                        state={states.microphone}
                        onRequest={() => request('microphone')}
                    />
                    <PermissionRow
                        title="Location"
                        purpose="Adds where you are to an alert."
                        detail="Only read when you are being protected, and only shared in a message you send."
                        state={states.location}
                        onRequest={() => request('location')}
                    />
                    <PermissionRow
                        title="Motion sensors"
                        purpose="Notices sudden falls or struggles."
                        detail="Most laptops and desktops do not have these."
                        state={states.motion}
                        onRequest={() => request('motion')}
                    />
                </ul>

                <div className="screen-actions">
                    <button type="button" className="btn-primary" onClick={() => navigate('/contacts')}>
                        Continue
                    </button>
                    <p className="screen-note">
                        {grantedCount === 0
                            ? 'You can continue without allowing anything — SafeSignal will still let you raise an alert by hand.'
                            : `${grantedCount} allowed. SafeSignal will use whichever of these are working.`}
                    </p>
                </div>
            </div>
        </div>
    );
};

const STATE_TEXT = {
    idle: 'Not set',
    requesting: 'Asking…',
    granted: 'Allowed',
    denied: 'Not allowed',
    unsupported: 'Unavailable here',
};

const PermissionRow = ({ title, purpose, detail, state, onRequest }) => {
    const isActionable = state === 'idle' || state === 'denied';

    return (
        <li className={`permission-row permission-row--${state}`}>
            <div className="permission-copy">
                <h2 className="permission-title">{title}</h2>
                <p className="permission-purpose">{purpose}</p>
                <p className="permission-detail">{detail}</p>
            </div>

            <div className="permission-action">
                <span className={`permission-state permission-state--${state}`}>
                    {STATE_TEXT[state]}
                </span>
                {isActionable && (
                    <button type="button" className="btn-secondary btn-small" onClick={onRequest}>
                        {state === 'denied' ? 'Try again' : 'Allow'}
                    </button>
                )}
            </div>
        </li>
    );
};

export default PermissionScreen;
