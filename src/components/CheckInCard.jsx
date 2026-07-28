import { useState } from 'react';
import {
    DURATION_PRESETS,
    formatDuration,
    formatRemaining,
    GRACE_MS,
} from '../utils/checkIn';
import './CheckInCard.css';

/**
 * Check-in timer card.
 *
 * Deliberately independent of the protection toggle and the sensors. The point
 * of a dead-man's switch is that it needs nothing from you at the moment it
 * matters — so it must not depend on the camera being on, the microphone being
 * allowed, or the phone being held a particular way.
 *
 * Props:
 *   phase, remainingMs, graceRemainingMs, record
 *   onStart(durationMs, note), onExtend(extraMs), onCheckIn()
 */
const CheckInCard = ({ phase, remainingMs, graceRemainingMs, record, onStart, onExtend, onCheckIn }) => {
    const [note, setNote] = useState('');
    const [selected, setSelected] = useState(DURATION_PRESETS[1]);

    if (phase === 'counting' || phase === 'grace' || phase === 'fired') {
        return (
            <section className={`checkin-card checkin-card--${phase}`} aria-labelledby="checkin-heading">
                <header className="checkin-header">
                    <h2 id="checkin-heading" className="checkin-title">
                        {phase === 'counting' && 'Checking in'}
                        {phase === 'grace' && 'Are you okay?'}
                        {phase === 'fired' && 'Check-in missed'}
                    </h2>
                </header>

                {phase === 'counting' && (
                    <>
                        <p className="checkin-countdown" aria-live="polite">
                            {formatRemaining(remainingMs)}
                        </p>
                        <p className="checkin-sub">
                            If you don&apos;t check in by then, SafeSignal will prepare your alert.
                        </p>
                    </>
                )}

                {phase === 'grace' && (
                    <>
                        <p className="checkin-countdown checkin-countdown--urgent" aria-live="assertive">
                            {formatRemaining(graceRemainingMs)}
                        </p>
                        <p className="checkin-sub">
                            Your time is up. Tap below and nothing happens.
                        </p>
                    </>
                )}

                {phase === 'fired' && (
                    <p className="checkin-sub">
                        Your alert was prepared because you didn&apos;t check in.
                    </p>
                )}

                {record?.note && <p className="checkin-note">&ldquo;{record.note}&rdquo;</p>}

                <div className="checkin-actions">
                    <button type="button" className="btn-checkin" onClick={onCheckIn}>
                        I&apos;m safe
                    </button>
                    {phase !== 'fired' && (
                        <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => onExtend(15 * 60 * 1000)}
                        >
                            +15 min
                        </button>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className="checkin-card" aria-labelledby="checkin-heading">
            <header className="checkin-header">
                <h2 id="checkin-heading" className="checkin-title">Check-in timer</h2>
                <p className="checkin-sub">
                    For when you can&apos;t speak or move. Set a time — if you don&apos;t
                    check in, SafeSignal alerts your contacts without you doing anything.
                </p>
            </header>

            <fieldset className="checkin-durations">
                <legend className="checkin-legend">How long?</legend>
                {DURATION_PRESETS.map((minutes) => (
                    <label
                        key={minutes}
                        className={`duration-option ${selected === minutes ? 'is-selected' : ''}`}
                    >
                        <input
                            type="radio"
                            name="checkin-duration"
                            value={minutes}
                            checked={selected === minutes}
                            onChange={() => setSelected(minutes)}
                        />
                        <span>{formatDuration(minutes)}</span>
                    </label>
                ))}
            </fieldset>

            <div className="field">
                <label htmlFor="checkin-note">What are you doing? (optional)</label>
                <input
                    id="checkin-note"
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Walking home from the station"
                    maxLength={200}
                />
            </div>

            <button
                type="button"
                className="btn-primary"
                onClick={() => onStart(selected * 60 * 1000, note)}
            >
                Start check-in
            </button>

            <p className="checkin-footnote">
                You get {Math.round(GRACE_MS / 1000)} seconds to cancel after the time is up.
                This keeps running even if you close the app.
            </p>
        </section>
    );
};

export default CheckInCard;
