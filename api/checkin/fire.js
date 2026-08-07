/**
 * POST /api/checkin/fire
 *
 * Called by the scheduler once a check-in's deadline and grace period have both
 * passed. This is the endpoint that closes the gap a browser cannot: it calls
 * and texts the contacts with no help from the person's phone, so the alert
 * still goes out if they are unable to act.
 *
 * Three guards, in order:
 *   1. The token must be valid — otherwise anyone could trigger someone's alert.
 *   2. The record must still exist — cancelling deletes it, so a cancelled
 *      check-in cannot ring anyone even if the callback still arrives.
 *   3. The fire must be claimable — schedulers retry, and a contact must not be
 *      rung twice for one missed check-in.
 */

import { sendJson, readJsonBody, rejectWrongMethod } from '../_lib/http.js';
import { isConfigured } from '../_lib/config.js';
import { verifyToken } from '../_lib/tokens.js';
import { getCheckIn, putCheckIn, claimFire, releaseFire } from '../_lib/store.js';
import { dispatchAlert } from '../_lib/messenger.js';

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
    if (rejectWrongMethod(req, res, 'POST')) return;

    if (!isConfigured()) {
        sendJson(res, 503, { error: 'The backend is not configured.' });
        return;
    }

    const body = await readJsonBody(req);
    if (!body?.id || !body?.token) {
        sendJson(res, 400, { error: 'id and token are required.' });
        return;
    }

    if (!(await verifyToken(body.id, body.token))) {
        sendJson(res, 403, { error: 'Invalid token.' });
        return;
    }

    const record = await getCheckIn(body.id);
    if (!record) {
        // Cancelled, or expired out of the store. Answer 200 so the scheduler
        // treats it as handled and stops retrying.
        sendJson(res, 200, {
            ok: true,
            fired: false,
            reason: 'Check-in was cancelled or has expired.',
        });
        return;
    }

    if (record.status === 'fired') {
        sendJson(res, 200, { ok: true, fired: false, reason: 'Already dispatched.' });
        return;
    }

    // Guard against a retry racing an in-flight dispatch.
    if (!(await claimFire(body.id))) {
        sendJson(res, 200, {
            ok: true,
            fired: false,
            reason: 'Another delivery already claimed this.',
        });
        return;
    }

    try {
        const { warning, results } = await dispatchAlert(record);

        await putCheckIn({ ...record, status: 'fired', firedAt: Date.now(), results });

        sendJson(res, 200, {
            ok: true,
            fired: true,
            contacts: results.length,
            reached: results.filter((r) => r.ok).length,
            warning,
            results,
        });
    } catch (error) {
        // Hand the claim back before answering, or the retry this 5xx invites
        // would short-circuit on a claim nobody holds and the alert would never
        // go out at all.
        await releaseFire(body.id).catch(() => { });
        sendJson(res, 500, { error: `Dispatch failed: ${error.message}` });
    }
}
