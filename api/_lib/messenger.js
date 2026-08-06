/**
 * Dispatches the alert through whichever provider is configured.
 *
 * Every contact is attempted independently. One bad number, one provider
 * hiccup, or one contact whose phone rejects the call must never stop the
 * others being reached — so failures are collected and reported rather than
 * thrown.
 *
 * Both channels are used on purpose: the call gets attention, the text carries
 * the location and survives being missed.
 */

import { config } from './config.js';
import { buildTwiml, buildTextMessage } from './compose.js';
import * as consoleProvider from './providers/console.js';
import * as twilioProvider from './providers/twilio.js';
import * as exotelProvider from './providers/exotel.js';

const PROVIDERS = {
    console: consoleProvider,
    twilio: twilioProvider,
    exotel: exotelProvider,
};

/**
 * Resolve the configured provider, falling back to console rather than
 * throwing — an unknown name should degrade to "logged, not sent", never to a
 * crash that loses the alert entirely.
 *
 * @returns {{ provider: Object, warning: string|null }}
 */
export const resolveProvider = () => {
    const provider = PROVIDERS[config.provider];
    if (!provider) {
        return {
            provider: consoleProvider,
            warning: `Unknown MESSAGING_PROVIDER "${config.provider}"; logging instead of sending.`,
        };
    }

    const missing = provider.missingSettings?.() ?? [];
    if (missing.length > 0) {
        return {
            provider: consoleProvider,
            warning: `${provider.name} is missing ${missing.join(', ')}; logging instead of sending.`,
        };
    }

    return { provider, warning: null };
};

/**
 * Reach every contact on a missed check-in.
 *
 * @param {Object} record
 * @returns {Promise<{ warning: string|null, results: Array }>}
 */
export const dispatchAlert = async (record) => {
    const { provider, warning } = resolveProvider();
    const twiml = buildTwiml(record);
    const body = buildTextMessage(record);

    const contacts = Array.isArray(record.contacts) ? record.contacts : [];

    const results = await Promise.all(
        contacts.map(async (contact) => {
            const to = normaliseNumber(contact.phone);
            if (!to) {
                return { contact: contact.name, ok: false, error: 'No usable phone number' };
            }

            // Settled, not all-or-nothing: a failed call must not prevent the
            // text that carries the location.
            const [call, text] = await Promise.allSettled([
                provider.placeCall({ to, twiml, record }),
                provider.sendText({ to, body, record }),
            ]);

            return {
                contact: contact.name,
                call: describeOutcome(call),
                text: describeOutcome(text),
                ok: succeeded(call) || succeeded(text),
            };
        }),
    );

    return { warning, results };
};

/**
 * @param {PromiseSettledResult<any>} settled
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
const describeOutcome = (settled) => {
    if (settled.status === 'rejected') {
        return { ok: false, error: String(settled.reason?.message ?? settled.reason) };
    }
    return settled.value;
};

/**
 * @param {PromiseSettledResult<any>} settled
 * @returns {boolean}
 */
const succeeded = (settled) => settled.status === 'fulfilled' && settled.value?.ok === true;

/**
 * Keep digits and a leading +. A number the provider will reject is better
 * caught here, where it can be reported per contact.
 *
 * @param {string} phone
 * @returns {string|null}
 */
export const normaliseNumber = (phone) => {
    const cleaned = String(phone ?? '').replace(/[^\d+]/g, '');
    const digits = cleaned.replace(/\D/g, '');
    return digits.length >= 6 ? cleaned : null;
};
