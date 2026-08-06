/**
 * Client for the server-side check-in.
 *
 * Strictly an enhancement. The on-device timer keeps working exactly as before;
 * registering remotely additionally lets the alert go out when the person
 * cannot act — which is the one thing a browser cannot do for itself.
 *
 * Every failure here is silent to the safety logic and loud to the UI: if
 * registration fails, the local timer still runs, and the card says plainly
 * that the alert will need to be sent by hand. Believing you are covered when
 * you are not is the worst possible failure for this feature, so the state is
 * always reported honestly.
 */

import { readJSON, writeJSON, removeKey } from './storage.js';

const REMOTE_KEY = 'safesignal.remoteCheckIn';

/** @returns {boolean} whether this build was told a backend exists */
export const isRemoteEnabled = () => import.meta.env?.VITE_BACKEND_ENABLED === 'true';

/**
 * @typedef {Object} RemoteHandle
 * @property {string} id
 * @property {string} token
 * @property {number} firesAt
 * @property {number} contacts
 */

/** @returns {RemoteHandle|null} */
export const loadRemoteHandle = () => {
    const stored = readJSON(REMOTE_KEY, null);
    if (!stored?.id || !stored?.token) return null;
    return stored;
};

const saveRemoteHandle = (handle) => writeJSON(REMOTE_KEY, handle);

export const clearRemoteHandle = () => removeKey(REMOTE_KEY);

/**
 * Register a check-in with the server.
 *
 * @param {{ durationMs: number, note?: string, userName?: string, contacts: Array, location?: Object|null }} params
 * @returns {Promise<{ ok: true, handle: RemoteHandle } | { ok: false, error: string }>}
 */
export const registerRemoteCheckIn = async (params) => {
    if (!isRemoteEnabled()) {
        return { ok: false, error: 'No backend is configured for this build.' };
    }

    try {
        const response = await fetch('/api/checkin/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                durationMs: params.durationMs,
                note: params.note ?? '',
                userName: params.userName ?? '',
                contacts: (params.contacts ?? []).map((c) => ({ name: c.name, phone: c.phone })),
                location: params.location ?? null,
            }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            return { ok: false, error: payload.error ?? `Server returned ${response.status}` };
        }

        const handle = {
            id: payload.id,
            token: payload.token,
            firesAt: payload.firesAt,
            contacts: payload.contacts,
        };
        saveRemoteHandle(handle);
        return { ok: true, handle };
    } catch (error) {
        return { ok: false, error: error.message ?? 'Could not reach the server.' };
    }
};

/**
 * Tell the server the person is safe.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export const cancelRemoteCheckIn = async () => {
    const handle = loadRemoteHandle();
    if (!handle) return { ok: true };

    try {
        const response = await fetch('/api/checkin/safe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: handle.id, token: handle.token }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            // Leave the handle in place so a later attempt can retry it.
            return { ok: false, error: payload.error ?? `Server returned ${response.status}` };
        }

        clearRemoteHandle();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message ?? 'Could not reach the server.' };
    }
};

/**
 * Plain-language description of what will actually happen, for the UI.
 *
 * @param {'on'|'off'|'failed'} state
 * @returns {string}
 */
export const describeRemoteState = (state) => ({
    on: 'Your contacts will be called and texted automatically if you miss this.',
    off: 'You will need to send the alert yourself — this device cannot send it for you.',
    failed: 'Could not reach the server, so you will need to send the alert yourself.',
}[state] ?? '');
