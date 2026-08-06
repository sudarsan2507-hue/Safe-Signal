import { useState, useEffect, useCallback, useRef } from 'react';
import {
    loadCheckIn,
    startCheckIn,
    extendCheckIn,
    cancelCheckIn,
    markCheckInFired,
    evaluateCheckIn,
} from '../utils/checkIn.js';
import {
    isRemoteEnabled,
    registerRemoteCheckIn,
    cancelRemoteCheckIn,
    clearRemoteHandle,
} from '../utils/remoteCheckIn.js';
import { loadContacts } from '../utils/storage.js';

/**
 * Drive a check-in timer.
 *
 * The phase is derived from stored timestamps on every render, never
 * accumulated. That is what lets an expiry survive the tab being closed, the
 * phone sleeping, or the browser being killed — reopening the app re-derives
 * the truth rather than resuming a timer that stopped existing.
 *
 * @param {(record: Object) => void} onExpire - called once when the grace period runs out
 * @returns {Object}
 */
export const useCheckIn = (onExpire, location = null) => {
    const [record, setRecord] = useState(loadCheckIn);
    const [now, setNow] = useState(() => Date.now());

    // 'off'  — no backend in this build; the alert must be sent by hand
    // 'pending' / 'on' / 'failed' — what the server actually agreed to do
    const [remoteState, setRemoteState] = useState(() => (isRemoteEnabled() ? 'off' : 'off'));
    const [remoteError, setRemoteError] = useState(null);

    const onExpireRef = useRef(onExpire);
    const firingRef = useRef(false);
    const locationRef = useRef(location);

    useEffect(() => {
        locationRef.current = location;
    }, [location]);

    useEffect(() => {
        onExpireRef.current = onExpire;
    });

    // Pure derivation — no effect needs to write this.
    const state = evaluateCheckIn(record, now);

    useEffect(() => {
        if (!record || record.status === 'fired') return undefined;

        const tick = () => {
            const current = Date.now();
            setNow(current);

            const next = evaluateCheckIn(record, current);
            if (next.phase === 'fire' && !firingRef.current) {
                firingRef.current = true;
                setRecord(markCheckInFired(record, current));
                onExpireRef.current?.(record);
            }
        };

        // Run one tick out-of-band so a deadline that passed while the app was
        // closed fires on open, without writing state from the effect body.
        const immediate = setTimeout(tick, 0);
        const interval = setInterval(tick, 1000);

        return () => {
            clearTimeout(immediate);
            clearInterval(interval);
        };
    }, [record]);

    const start = useCallback((durationMs, note) => {
        const created = startCheckIn(durationMs, note);
        if (!created) return null;

        firingRef.current = false;
        setNow(Date.now());
        setRecord(created);

        // The local timer is authoritative and already running. Registering
        // with the server is an additional guarantee, so its failure must never
        // block the check-in — only change what the UI promises.
        if (isRemoteEnabled()) {
            setRemoteState('pending');
            registerRemoteCheckIn({
                durationMs,
                note,
                contacts: loadContacts(),
                location: locationRef.current,
            }).then((result) => {
                setRemoteState(result.ok ? 'on' : 'failed');
                setRemoteError(result.ok ? null : result.error);
            });
        }

        return created;
    }, []);

    // extendCheckIn writes to storage, so it must not run inside a state
    // updater — those have to stay pure.
    const extend = useCallback((extraMs) => {
        if (!record) return;
        firingRef.current = false;
        setRecord(extendCheckIn(record, extraMs));
        setNow(Date.now());
    }, [record]);

    const checkIn = useCallback(() => {
        cancelCheckIn();
        firingRef.current = false;
        setRecord(null);
        setNow(Date.now());

        if (isRemoteEnabled()) {
            cancelRemoteCheckIn().then((result) => {
                // A cancel that did not reach the server is worth saying out
                // loud — the contacts may still be called.
                setRemoteState(result.ok ? 'off' : 'failed');
                setRemoteError(result.ok ? null : 'Could not tell the server you are safe.');
            });
        } else {
            clearRemoteHandle();
            setRemoteState('off');
            setRemoteError(null);
        }
    }, []);

    return {
        record,
        phase: state.phase,
        remainingMs: state.remainingMs,
        graceRemainingMs: state.graceRemainingMs,
        overdueMs: state.overdueMs,
        remoteState,
        remoteError,
        start,
        extend,
        checkIn,
    };
};

export default useCheckIn;
