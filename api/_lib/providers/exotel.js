/**
 * Exotel provider — India.
 *
 * Preferred over Twilio for Indian numbers: Exotel is a domestic operator and
 * handles TRAI/DLT registration and DND clearance as part of onboarding, rather
 * than as paperwork bolted onto an international account.
 *
 * One structural difference worth knowing: Exotel does not read text aloud from
 * the API the way TwiML does. A call is connected to a pre-built flow (an
 * "applet") configured in their dashboard, so the spoken wording lives there,
 * not here. EXOTEL_FLOW_URL points at that flow. The text message still carries
 * the full detail, which is why the alert never depends on the call alone.
 */

import { config } from '../config.js';

/**
 * @returns {string}
 */
const baseUrl = () => `https://api.exotel.com/v1/Accounts/${config.exotel.accountSid}`;

/**
 * @returns {string}
 */
const authHeader = () => {
    const raw = `${config.exotel.apiKey}:${config.exotel.apiToken}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
};

/**
 * @param {string} path
 * @param {Record<string, string>} form
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
const post = async (path, form) => {
    const response = await fetch(`${baseUrl()}/${path}`, {
        method: 'POST',
        headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        return {
            ok: false,
            error: payload?.RestException?.Message ?? `Exotel returned ${response.status}`,
        };
    }

    return { ok: true, id: payload?.Call?.Sid ?? payload?.SMSMessage?.Sid };
};

/**
 * Connect the contact to the configured flow.
 *
 * The `twiml` argument is accepted for interface parity and ignored — see the
 * note at the top of this file.
 *
 * @param {{ to: string }} params
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export const placeCall = ({ to }) =>
    post('Calls/connect.json', {
        From: to,
        CallerId: config.exotel.callerId,
        Url: config.exotel.flowUrl,
    });

/**
 * @param {{ to: string, body: string }} params
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export const sendText = ({ to, body }) =>
    post('Sms/send.json', {
        From: config.exotel.callerId,
        To: to,
        Body: body,
    });

export const name = 'exotel';

/** @returns {string[]} */
export const missingSettings = () => {
    const missing = [];
    if (!config.exotel.accountSid) missing.push('EXOTEL_ACCOUNT_SID');
    if (!config.exotel.apiKey) missing.push('EXOTEL_API_KEY');
    if (!config.exotel.apiToken) missing.push('EXOTEL_API_TOKEN');
    if (!config.exotel.callerId) missing.push('EXOTEL_CALLER_ID');
    if (!config.exotel.flowUrl) missing.push('EXOTEL_FLOW_URL');
    return missing;
};
