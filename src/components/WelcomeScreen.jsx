import { useNavigate } from 'react-router-dom';
import './WelcomeScreen.css';

/**
 * First-run screen.
 *
 * The copy promises only what the app does. Earlier wording claimed encrypted
 * data and background monitoring, neither of which was true — for a safety
 * tool, an overstated promise is a defect, not marketing.
 */
const WelcomeScreen = () => {
    const navigate = useNavigate();

    return (
        <div className="page welcome-screen">
            <div className="screen-inner welcome-inner">
                <div className="welcome-mark" aria-hidden="true">
                    <svg viewBox="0 0 96 96" width="72" height="72" fill="none">
                        <circle cx="48" cy="48" r="44" className="mark-ring" strokeWidth="4" />
                        <path
                            d="M48 26c6 6 13 9 20 9v14c0 14-8 22-20 27-12-5-20-13-20-27V35c7 0 14-3 20-9Z"
                            className="mark-shield"
                            strokeWidth="4"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>

                <h1 className="welcome-title">SafeSignal</h1>
                <p className="welcome-tagline">A quiet way to ask for help.</p>

                <p className="welcome-body">
                    SafeSignal watches for a hand signal, tension in your voice, and sudden
                    movement. When something looks wrong, it gets a message ready for the people
                    you trust — and always gives you a chance to stop it.
                </p>

                <ul className="welcome-points">
                    <li>
                        <span className="point-title">Nothing leaves your device</span>
                        <span className="point-detail">
                            Camera and microphone are analysed here. No recordings, no uploads, no account.
                        </span>
                    </li>
                    <li>
                        <span className="point-title">You are always in control</span>
                        <span className="point-detail">
                            Every alert waits ten seconds first, and one tap stops it.
                        </span>
                    </li>
                    <li>
                        <span className="point-title">It works with what you allow</span>
                        <span className="point-detail">
                            Turn on only the sensors you want. SafeSignal tells you what it is using.
                        </span>
                    </li>
                </ul>

                <div className="screen-actions">
                    <button type="button" className="btn-primary" onClick={() => navigate('/permissions')}>
                        Get started
                    </button>
                </div>

                <p className="screen-note">
                    SafeSignal cannot contact emergency services for you. In an emergency, call your
                    local emergency number.
                </p>
            </div>
        </div>
    );
};

export default WelcomeScreen;
