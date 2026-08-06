/**
 * Check-in storage, backed by Upstash Redis over its REST API.
 *
 * Uses plain fetch rather than an SDK so the backend adds no dependencies —
 * nothing to install before it runs, and nothing to keep patched.
 *
 * Records carry a TTL so an abandoned check-in cannot linger indefinitely: the
 * store forgets it a while after it was due, whatever happened.
 */

import { config } from './config.js';

/** Extra time a record is kept beyond its deadline, for status lookups. */
const RETENTION_AFTER_DUE_S = 24 * 60 * 60;

/**
 * Run one Redis command.
 *
 * @param {(string|number)[]} command
 * @returns {Promise<any>} the `result` field
 */
const execute = async (command) => {
    const response = await fetch(config.redis.url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.redis.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Redis command failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    return payload.result;
};

/**
 * @param {string} id
 * @returns {string}
 */
const keyFor = (id) => `safesignal:checkin:${id}`;

/**
 * Store a check-in, expiring it a day after it was due.
 *
 * @param {Object} record - must carry expiresAt (ms since epoch)
 * @returns {Promise<void>}
 */
export const putCheckIn = async (record) => {
    const secondsUntilDue = Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 1000));
    const ttl = secondsUntilDue + RETENTION_AFTER_DUE_S;
    await execute(['SET', keyFor(record.id), JSON.stringify(record), 'EX', ttl]);
};

/**
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getCheckIn = async (id) => {
    const raw = await execute(['GET', keyFor(id)]);
    if (!raw) return null;
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        // A record we cannot parse is a record we cannot act on.
        return null;
    }
};

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export const deleteCheckIn = async (id) => {
    await execute(['DEL', keyFor(id)]);
};

/**
 * Claim the right to fire a check-in exactly once.
 *
 * A scheduler may deliver the same callback more than once — QStash retries on
 * any non-2xx, and a network hiccup after we have already placed the calls
 * looks exactly like a failure. Without this, one missed check-in could ring a
 * contact repeatedly.
 *
 * @param {string} id
 * @returns {Promise<boolean>} true if this caller may proceed
 */
export const claimFire = async (id) => {
    const result = await execute(['SET', `${keyFor(id)}:fired`, '1', 'NX', 'EX', RETENTION_AFTER_DUE_S]);
    return result === 'OK';
};

/**
 * Give the claim back after a failed dispatch.
 *
 * Without this, a transient provider outage would be permanent: the claim would
 * still be held, so every scheduler retry would short-circuit and the alert
 * would never go out. The claim must only outlive an attempt that succeeded.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export const releaseFire = async (id) => {
    await execute(['DEL', `${keyFor(id)}:fired`]);
};
