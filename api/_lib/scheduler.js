/**
 * Deadline scheduling, backed by Upstash QStash over its REST API.
 *
 * QStash schedules a single HTTP callback for an exact future moment, which is
 * a better fit than cron: a five-minute check-in does not want a job polling
 * every minute asking whether anything has expired, and Vercel's Hobby plan
 * limits cron frequency too severely for that to work anyway.
 */

import { config } from './config.js';

const QSTASH_PUBLISH = 'https://qstash.upstash.io/v2/publish';
const QSTASH_MESSAGES = 'https://qstash.upstash.io/v2/messages';

/** QStash caps how far ahead a message may be delayed. */
const MAX_DELAY_S = 7 * 24 * 60 * 60;

/**
 * Ask for a callback at (or just after) a given moment.
 *
 * @param {{ id: string, fireAt: number, payload: Object }} params
 * @returns {Promise<{ messageId: string }>}
 */
export const scheduleFire = async ({ id, fireAt, payload }) => {
    const delaySeconds = Math.max(0, Math.min(Math.ceil((fireAt - Date.now()) / 1000), MAX_DELAY_S));
    const destination = `${config.baseUrl}/api/checkin/fire`;

    const response = await fetch(`${QSTASH_PUBLISH}/${destination}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.qstash.token}`,
            'Content-Type': 'application/json',
            'Upstash-Delay': `${delaySeconds}s`,
            // Retries matter here: a transient failure to reach our own
            // endpoint must not mean the alert is simply dropped.
            'Upstash-Retries': '3',
            'Upstash-Deduplication-Id': `checkin-${id}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Could not schedule the check-in (${response.status}): ${detail.slice(0, 200)}`);
    }

    const result = await response.json();
    return { messageId: result.messageId };
};

/**
 * Cancel a scheduled callback.
 *
 * Best effort by design. The record is deleted from the store first, and the
 * fire endpoint refuses to act on a record that is gone — so a failure to
 * cancel here costs a wasted callback, never a false alarm.
 *
 * @param {string} messageId
 * @returns {Promise<boolean>}
 */
export const cancelFire = async (messageId) => {
    if (!messageId) return false;

    try {
        const response = await fetch(`${QSTASH_MESSAGES}/${messageId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${config.qstash.token}` },
        });
        // 404 means it already ran or never existed; either way there is
        // nothing left to cancel.
        return response.ok || response.status === 404;
    } catch {
        return false;
    }
};
