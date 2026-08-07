/**
 * POST /api/checkin/start
 *
 * Registers a check-in so the alert can go out without the person's phone
 * doing anything. Returns an id and a token; the client keeps both and needs
 * the token to cancel.
 *
 * The request is validated strictly. Whatever is stored here may later be read
 * aloud down a phone line and texted to real people, so it is treated as
 * untrusted input rather than as our own data coming home.
 */

import { sendJson, readJsonBody, rejectWrongMethod } from '../_lib/http.js';
import { isConfigured, missingConfig, hasUsableSecret } from '../_lib/config.js';
import { createId, signId } from '../_lib/tokens.js';
import { putCheckIn } from '../_lib/store.js';
import { scheduleFire } from '../_lib/scheduler.js';

/** Bounds mirrored from the client, re-checked because clients can lie. */
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_CONTACTS = 10;

/** Delay after the deadline before dispatching, matching the on-device grace. */
const GRACE_MS = 60_000;

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
    if (rejectWrongMethod(req, res, 'POST')) return;

    if (!isConfigured()) {
        // Name the missing pieces: a backend that accepts a check-in it cannot
        // act on is worse than one that refuses outright.
        sendJson(res, 503, {
            error: 'The backend is not configured.',
            missing: missingConfig(),
        });
        return;
    }

    if (!hasUsableSecret()) {
        sendJson(res, 503, {
            error: 'CHECKIN_SIGNING_SECRET is too short; use at least 32 characters.',
        });
        return;
    }

    const body = await readJsonBody(req);
    if (!body) {
        sendJson(res, 400, { error: 'Expected a JSON body.' });
        return;
    }

    const durationMs = Number(body.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
        sendJson(res, 400, { error: 'durationMs must be between 1 minute and 12 hours.' });
        return;
    }

    const contacts = Array.isArray(body.contacts) ? body.contacts.slice(0, MAX_CONTACTS) : [];
    const usable = contacts
        .filter((c) => c && typeof c.phone === 'string' && c.phone.trim() !== '')
        .map((c) => ({
            name: String(c.name ?? '').slice(0, 60),
            phone: String(c.phone).slice(0, 24),
        }));

    if (usable.length === 0) {
        sendJson(res, 400, { error: 'At least one contact with a phone number is required.' });
        return;
    }

    const id = createId();
    const token = await signId(id);
    const expiresAt = Date.now() + durationMs;

    const record = {
        id,
        createdAt: Date.now(),
        expiresAt,
        note: String(body.note ?? '').slice(0, 200),
        userName: String(body.userName ?? '').slice(0, 60),
        contacts: usable,
        location: parseLocation(body.location),
        status: 'active',
    };

    try {
        await putCheckIn(record);
        const { messageId } = await scheduleFire({
            id,
            fireAt: expiresAt + GRACE_MS,
            payload: { id, token },
        });

        // Keep the scheduler handle so cancelling can withdraw the callback.
        await putCheckIn({ ...record, scheduledMessageId: messageId });

        sendJson(res, 201, {
            id,
            token,
            expiresAt,
            firesAt: expiresAt + GRACE_MS,
            contacts: usable.length,
        });
    } catch (error) {
        // Failing loudly matters: the client must fall back to its on-device
        // timer rather than believe it is covered when it is not.
        sendJson(res, 502, { error: `Could not register the check-in: ${error.message}` });
    }
}

/**
 * @param {any} value
 * @returns {{lat: number, lng: number, accuracy: number|null}|null}
 */
const parseLocation = (value) => {
    if (!value || typeof value !== 'object') return null;
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    const accuracy = Number(value.accuracy);
    return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null };
};
