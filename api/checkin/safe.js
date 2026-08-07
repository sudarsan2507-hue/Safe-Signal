/**
 * POST /api/checkin/safe
 *
 * "I'm safe" — cancels a registered check-in.
 *
 * Requires the token issued at registration. Without that, anyone able to guess
 * an id could switch off somebody else's safety timer and leave them believing
 * they were being watched over. That is the attack this endpoint exists to
 * prevent, so an invalid token is refused before anything else happens.
 */

import { sendJson, readJsonBody, rejectWrongMethod } from '../_lib/http.js';
import { isConfigured } from '../_lib/config.js';
import { verifyToken } from '../_lib/tokens.js';
import { getCheckIn, deleteCheckIn } from '../_lib/store.js';
import { cancelFire } from '../_lib/scheduler.js';

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
        // Deliberately identical to "not found": distinguishing them would
        // confirm which ids exist.
        sendJson(res, 404, { error: 'No such check-in.' });
        return;
    }

    try {
        const record = await getCheckIn(body.id);

        // Delete the record first. The fire endpoint refuses to act on a record
        // that is gone, so even if withdrawing the scheduled callback fails the
        // worst outcome is a wasted callback — never a false alarm.
        await deleteCheckIn(body.id);
        await cancelFire(record?.scheduledMessageId);

        sendJson(res, 200, { ok: true, cancelled: Boolean(record) });
    } catch (error) {
        sendJson(res, 502, { error: `Could not cancel the check-in: ${error.message}` });
    }
}
