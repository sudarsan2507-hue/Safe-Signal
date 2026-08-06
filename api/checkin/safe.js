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

import { json, readJson, requireMethod } from '../_lib/http.js';
import { isConfigured } from '../_lib/config.js';
import { verifyToken } from '../_lib/tokens.js';
import { getCheckIn, deleteCheckIn } from '../_lib/store.js';
import { cancelFire } from '../_lib/scheduler.js';

export const config = { runtime: 'nodejs' };

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default async function handler(request) {
    const wrongMethod = requireMethod(request, 'POST');
    if (wrongMethod) return wrongMethod;

    if (!isConfigured()) {
        return json(503, { error: 'The backend is not configured.' });
    }

    const body = await readJson(request);
    if (!body?.id || !body?.token) {
        return json(400, { error: 'id and token are required.' });
    }

    if (!(await verifyToken(body.id, body.token))) {
        // Deliberately identical to "not found": distinguishing them would
        // confirm which ids exist.
        return json(404, { error: 'No such check-in.' });
    }

    try {
        const record = await getCheckIn(body.id);

        // Delete the record first. The fire endpoint refuses to act on a record
        // that is gone, so even if withdrawing the scheduled callback fails the
        // worst outcome is a wasted callback — never a false alarm.
        await deleteCheckIn(body.id);
        await cancelFire(record?.scheduledMessageId);

        return json(200, { ok: true, cancelled: Boolean(record) });
    } catch (error) {
        return json(502, { error: `Could not cancel the check-in: ${error.message}` });
    }
}
