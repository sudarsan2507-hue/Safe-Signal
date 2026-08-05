import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getGoogleMapsLink,
    formatCoords,
    describeAccuracy,
    isAccuracyUsable,
    explainPoorAccuracy,
} from '../utils/geo';
import { loadLastAlert } from '../utils/storage';
import {
    summariseSnapshot,
    describeMoment,
    formatRisk,
    formatTime,
} from '../utils/incidentLog';
import {
    markRecipientStatus,
    openSmsComposer,
    buildTelLink,
    shareAlert,
    copyAlert,
    canShare,
    describeStatus,
    summariseAlert,
} from '../utils/alerts';
import './EmergencyScreen.css';

/**
 * Alert screen.
 *
 * This screen states only what is actually true. SafeSignal has no server and
 * cannot send anything by itself, so it never claims contacts "have been
 * notified" — it prepares a real message, hands it to the device's own
 * messaging, and reports exactly how far each contact got.
 *
 * Location is shown as unavailable when it is unavailable. Substituting
 * placeholder coordinates would point help at the wrong place.
 */
const EmergencyScreen = () => {
    const navigate = useNavigate();
    const [alert, setAlert] = useState(loadLastAlert);
    const [toast, setToast] = useState('');

    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(''), 3000);
        return () => clearTimeout(timer);
    }, [toast]);

    if (!alert) {
        return (
            <div className="page emergency-screen">
                <div className="screen-inner emergency-empty">
                    <h1>No alert to show</h1>
                    <p className="screen-subtitle">
                        Nothing has been prepared yet. Head back and you will find everything as
                        you left it.
                    </p>
                    <button type="button" className="btn-primary" onClick={() => navigate('/dashboard')}>
                        Back to protection
                    </button>
                </div>
            </div>
        );
    }

    const summary = summariseAlert(alert);

    /**
     * @param {Object} recipient
     */
    const handleSms = (recipient) => {
        const status = openSmsComposer(recipient, alert.message);
        setAlert(markRecipientStatus(alert, recipient.id, status));
        if (status === 'failed') setToast('Could not open your messaging app.');
    };

    const handleShare = async () => {
        const status = await shareAlert(alert.message);
        if (status === 'shared') setToast('Shared.');
        else if (status === 'failed') setToast('Sharing is not available here.');
    };

    const handleCopy = async () => {
        const status = await copyAlert(alert.message);
        setToast(status === 'copied' ? 'Message copied.' : 'Could not copy the message.');
    };

    return (
        <div className="page emergency-screen">
            <div className="screen-inner">
                <header className="emergency-header">
                    <p className="emergency-eyebrow">SafeSignal</p>
                    <h1 className="emergency-title">{summary.headline}</h1>
                    <p className="emergency-detail">{summary.detail}</p>
                    {alert.reason && <p className="emergency-reason">Triggered by: {alert.reason}</p>}
                </header>

                {/* ── Location ───────────────────────────────────────── */}
                <section className="info-card" aria-labelledby="location-heading">
                    <h2 id="location-heading" className="info-heading">Your location</h2>
                    {alert.location ? (
                        <>
                            <p className="info-value">{formatCoords(alert.location)}</p>
                            <p
                                className={`info-sub ${isAccuracyUsable(alert.location.accuracy) ? '' : 'info-sub--warn'}`}
                            >
                                {describeAccuracy(alert.location.accuracy)}
                            </p>

                            {/* A pin from an IP lookup looks exactly as confident as one
                                from GPS, so the difference has to be said out loud. */}
                            {!isAccuracyUsable(alert.location.accuracy) && (
                                <p className="info-sub">{explainPoorAccuracy(alert.location.accuracy)}</p>
                            )}

                            <a
                                className="info-link"
                                href={getGoogleMapsLink(alert.location.lat, alert.location.lng)}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Open in Google Maps
                            </a>
                        </>
                    ) : (
                        <>
                            <p className="info-value info-value--muted">Not available</p>
                            <p className="info-sub">
                                {alert.locationError ?? 'Your location could not be determined.'} The
                                message below still works — add where you are if you can.
                            </p>
                        </>
                    )}
                </section>

                {/* ── Contacts ───────────────────────────────────────── */}
                <section className="info-card" aria-labelledby="contacts-heading">
                    <h2 id="contacts-heading" className="info-heading">
                        Reach your contacts
                    </h2>

                    {alert.recipients.length === 0 ? (
                        <p className="info-sub">
                            No contacts are saved.{' '}
                            <button type="button" className="link-button" onClick={() => navigate('/contacts')}>
                                Add one now
                            </button>
                        </p>
                    ) : (
                        <ul className="recipient-list">
                            {alert.recipients.map((recipient) => (
                                <li key={recipient.id} className={`recipient recipient--${recipient.status}`}>
                                    <div className="recipient-info">
                                        <span className="recipient-name">{recipient.name}</span>
                                        <span className="recipient-phone">{recipient.phone}</span>
                                        <span className="recipient-status">{describeStatus(recipient.status)}</span>
                                    </div>
                                    <div className="recipient-actions">
                                        {/* Calling is first: a ringing phone gets attention in
                                            seconds, where a text may sit unread. */}
                                        <a className="btn-call" href={buildTelLink(recipient.phone)}>
                                            Call
                                        </a>
                                        <button
                                            type="button"
                                            className="btn-send"
                                            onClick={() => handleSms(recipient)}
                                        >
                                            {recipient.status === 'ready' ? 'Message' : 'Again'}
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="bulk-actions">
                        {canShare() && (
                            <button type="button" className="btn-secondary" onClick={handleShare}>
                                Share another way
                            </button>
                        )}
                        <button type="button" className="btn-secondary" onClick={handleCopy}>
                            Copy message
                        </button>
                    </div>
                </section>

                {/* ── Why this happened ─────────────────────────────── */}
                {alert.incident?.length > 0 && <IncidentPanel entries={alert.incident} />}

                {/* ── Message preview ────────────────────────────────── */}
                <section className="info-card" aria-labelledby="message-heading">
                    <h2 id="message-heading" className="info-heading">What they will read</h2>
                    <pre className="message-preview">{alert.message}</pre>
                </section>

                {/* ── Emergency services ─────────────────────────────── */}
                <section className="info-card info-card--urgent">
                    <h2 className="info-heading">If you are in danger right now</h2>
                    <p className="info-sub">
                        Contact your local emergency number directly. SafeSignal cannot call
                        emergency services for you.
                    </p>
                </section>

                <div className="screen-actions">
                    <button type="button" className="btn-primary" onClick={() => navigate('/dashboard')}>
                        Back to protection
                    </button>
                </div>

                <p className="screen-note">
                    Prepared {new Date(alert.timestamp).toLocaleString()}. Saved on this device only.
                </p>
            </div>

            {toast && (
                <p className="toast" role="status">
                    {toast}
                </p>
            )}
        </div>
    );
};

/**
 * Explains what the sensors measured and what happened when.
 *
 * This is the app's answer to "why was this sent?" — deliberately a record of
 * readings rather than a recording. It also makes a false positive diagnosable
 * instead of mysterious.
 */
const IncidentPanel = ({ entries }) => {
    const summary = summariseSnapshot(entries);

    return (
        <section className="info-card" aria-labelledby="incident-heading">
            <h2 id="incident-heading" className="info-heading">Why this was sent</h2>

            {summary.peakReadings && (
                <dl className="incident-peaks">
                    {Object.entries(summary.peakReadings).map(([key, value]) => (
                        <div key={key}>
                            <dt>{SENSOR_NAMES[key] ?? key}</dt>
                            <dd>
                                {key === 'gesture'
                                    ? value >= 1 ? 'Held' : 'Not held'
                                    : `${Math.round(value * 100)}%`}
                            </dd>
                        </div>
                    ))}
                    <div>
                        <dt>Highest risk</dt>
                        <dd>{formatRisk(summary.peakRisk)}</dd>
                    </div>
                </dl>
            )}

            {summary.moments.length > 0 && (
                <ol className="incident-timeline">
                    {summary.moments.map((moment, index) => (
                        <li key={`${moment.t}-${index}`}>
                            <span className="incident-time">{formatTime(moment.t)}</span>
                            <span className="incident-what">{describeMoment(moment)}</span>
                        </li>
                    ))}
                </ol>
            )}

            <p className="info-sub">
                Sensor readings and times only. No audio, video or images were recorded.
            </p>
        </section>
    );
};

const SENSOR_NAMES = {
    gesture: 'Hand signal',
    stress: 'Voice tension',
    motion: 'Movement',
};

export default EmergencyScreen;
