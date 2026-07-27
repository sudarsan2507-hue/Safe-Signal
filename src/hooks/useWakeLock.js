import { useEffect, useRef, useState } from 'react';

/**
 * Hold a screen wake lock while `active` is true.
 *
 * Detection only runs while this page is in the foreground, so a screen that
 * sleeps silently stops the protection the user believes is running. Holding
 * the lock keeps that promise honest; where the API is unsupported the caller
 * is told so it can say as much rather than imply continuous coverage.
 *
 * @param {boolean} active
 * @returns {{ supported: boolean, held: boolean }}
 */
export const useWakeLock = (active) => {
    const sentinelRef = useRef(null);
    const [held, setHeld] = useState(false);
    const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

    useEffect(() => {
        if (!supported || !active) return undefined;

        let cancelled = false;

        const acquire = async () => {
            try {
                const sentinel = await navigator.wakeLock.request('screen');
                if (cancelled) {
                    sentinel.release().catch(() => { });
                    return;
                }
                sentinelRef.current = sentinel;
                setHeld(true);
                sentinel.addEventListener('release', () => setHeld(false));
            } catch {
                setHeld(false);
            }
        };

        // The lock is dropped whenever the tab is backgrounded, so it has to be
        // reacquired on return rather than assumed to persist.
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && active) acquire();
        };

        acquire();
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', handleVisibility);
            sentinelRef.current?.release().catch(() => { });
            sentinelRef.current = null;
            setHeld(false);
        };
    }, [active, supported]);

    return { supported, held };
};

export default useWakeLock;
