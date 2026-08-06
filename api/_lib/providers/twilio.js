/**
 * Twilio provider — global reach.
 *
 * Plain REST over fetch, no SDK, so the backend stays dependency-free.
 *
 * Caveat for Indian numbers: automated voice calls require a regulatory bundle
 * with a verified address, and India's DND registry restricts them. Exotel
 * handles domestic compliance far more smoothly — see providers/exotel.js.
 */

import { config } from '../config.js';

const API = 'https://api.twilio.com/2010-04-01/Accounts';

/**
 * @returns {string}
 */
const authHeader = () => {
    const raw = `${config.twilio.accountSid}:${config.twilio.authToken}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
};

/**
 * @param {string} resource - 'Calls' | 'Messages'
 * @param {Record<string, string>} form
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
const post = async (resource, form) => {
    const response = await fetch(`${API}/${config.twilio.accountSid}/${resource}.json`, {
        method: 'POST',
        headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        return { ok: false, error: payload.message ?? `Twilio returned ${response.status}` };
    }
    return { ok: true, id: payload.sid };
};

/**
 * @param {{ to: string, twiml: string }} params
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export const placeCall = ({ to, twiml }) =>
    post('Calls', { To: to, From: config.twilio.from, Twiml: twiml });

/**
 * @param {{ to: string, body: string }} params
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export const sendText = ({ to, body }) =>
    post('Messages', { To: to, From: config.twilio.from, Body: body });

export const name = 'twilio';

/** @returns {string[]} missing settings, so misconfiguration is diagnosable */
export const missingSettings = () => {
    const missing = [];
    if (!config.twilio.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!config.twilio.authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!config.twilio.from) missing.push('TWILIO_FROM_NUMBER');
    return missing;
};
