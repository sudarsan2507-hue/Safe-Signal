import { useState } from 'react';
import { DURATION_PRESETS, formatRemaining, GRACE_MS } from '../utils/checkIn';
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
                    For when you can&apos;t speak or move. Tap a time — if you don&apos;t
                    check in, SafeSignal alerts your contacts without you doing anything.
                </p>
            </header>

            {/* One tap starts the timer. Picking a duration and then confirming
                is two decisions, and someone reaching for this is usually
                already uneasy and in a hurry. */}
            <div className="checkin-durations" role="group" aria-label="Start a check-in">
                {DURATION_PRESETS.map((minutes) => (
                    <button
                        key={minutes}
                        type="button"
                        className="duration-start"
                        onClick={() => onStart(minutes * 60 * 1000, note)}
                    >
                        <span className="duration-value">{minutes}</span>
                        <span className="duration-unit">min</span>
                    </button>
                ))}
            </div>

            <details className="checkin-note-toggle">
                <summary>Add a note (optional)</summary>
                <div className="field">
                    <label htmlFor="checkin-note">What are you doing?</label>
                    <input
                        id="checkin-note"
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Walking home from the station"
                        maxLength={200}
                    />
                    <p className="checkin-footnote">
                        Included in the alert so your contact knows where to look.
                    </p>
                </div>
            </details>

            <p className="checkin-footnote">
                You get {Math.round(GRACE_MS / 1000)} seconds to cancel after the time is up,
                and you can add more time at any point. This keeps running even if you
                close the app.
            </p>
        </section>
    );
};

export default CheckInCard;
