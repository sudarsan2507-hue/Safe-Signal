/**
 * Alert dispatch.
 *
 * SafeSignal has no server, so it cannot send a message on the user's behalf.
 * Rather than pretend, this module prepares a real message and hands it to
 * channels the device genuinely has: the SMS composer, the system share sheet,
 * and the clipboard.
 *
 * Status vocabulary is deliberately cautious. Opening an SMS composer is not
 * proof of delivery, so the strongest state any contact reaches is "opened".
 * Nothing in this app may claim a contact was reached when it does not know.
 */

import { getGoogleMapsLink } from './geo.js';
import { saveLastAlert } from './storage.js';

/**
 * @typedef {'ready'|'opened'|'copied'|'shared'|'failed'} DeliveryStatus
 */

/**
 * Compose the message a contact will receive.
 *
 * @param {{ location: Object|null, locationError: string|null, reason: string|null, name?: string }} params
 * @returns {string}
 */
export const buildAlertMessage = ({ location, locationError, reason, name }) => {
    const who = name?.trim() ? name.trim() : 'Someone using SafeSignal';
    const lines = [`${who} may need help.`];

    if (reason) lines.push(`Reason: ${reason}.`);

    if (location) {
        lines.push(`Location: ${getGoogleMapsLink(location.lat, location.lng)}`);
        if (location.accuracy != null) {
            lines.push(`(accurate to about ${Math.round(location.accuracy)} m)`);
        }
    } else {
        lines.push(`Location: unavailable — ${locationError ?? 'could not be determined'}.`);
    }

    lines.push(`Time: ${new Date().toLocaleString()}`);
    lines.push('Sent from SafeSignal.');

    return lines.join('\n');
};

/**
 * Build an alert record. Every contact starts as "ready" — prepared, not sent.
 *
 * @param {{ contacts: Array, location: Object|null, locationError: string|null, reason: string|null, userName?: string }} params
 * @returns {Object}
 */
export const createAlert = ({ contacts, location, locationError, reason, userName }) => {
    const message = buildAlertMessage({ location, locationError, reason, name: userName });

    const alert = {
        id: `alert-${Date.now()}`,
        timestamp: new Date().toISOString(),
        reason: reason ?? null,
        location: location ?? null,
        locationError: locationError ?? null,
        message,
        recipients: (contacts ?? []).map((contact) => ({
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            status: /** @type {DeliveryStatus} */ ('ready'),
            updatedAt: null,
        })),
    };

    saveLastAlert(alert);
    return alert;
};

/**
 * Update one recipient's status and persist the change.
 *
 * @param {Object} alert
 * @param {string} contactId
 * @param {DeliveryStatus} status
 * @returns {Object} the updated alert
 */
export const markRecipientStatus = (alert, contactId, status) => {
    const updated = {
        ...alert,
        recipients: alert.recipients.map((r) =>
            r.id === contactId ? { ...r, status, updatedAt: new Date().toISOString() } : r,
        ),
    };
    saveLastAlert(updated);
    return updated;
};

/**
 * Build an `sms:` URL that pre-fills the composer.
 *
 * iOS and Android historically disagreed on the separator before `body`, so
 * the platform is sniffed rather than assumed.
 *
 * @param {string} phone
 * @param {string} message
 * @returns {string}
 */
export const buildSmsLink = (phone, message) => {
    const cleanedNumber = String(phone).replace(/[^\d+]/g, '');
    const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent ?? '');
    const separator = isAppleDevice ? '&' : '?';
    return `sms:${cleanedNumber}${separator}body=${encodeURIComponent(message)}`;
};

/**
 * Open the device SMS composer for one contact.
 * Resolves to the status actually achieved — never better than "opened".
 *
 * @param {Object} contact
 * @param {string} message
 * @returns {DeliveryStatus}
 */
export const openSmsComposer = (contact, message) => {
    try {
        window.location.href = buildSmsLink(contact.phone, message);
        return 'opened';
    } catch {
        return 'failed';
    }
};

/** @returns {boolean} whether the system share sheet is available */
export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Offer the message through the system share sheet.
 * @param {string} message
 * @returns {Promise<DeliveryStatus>}
 */
export const shareAlert = async (message) => {
    if (!canShare()) return 'failed';
    try {
        await navigator.share({ title: 'SafeSignal alert', text: message });
        return 'shared';
    } catch (error) {
        // A user dismissing the sheet is not a failure worth shouting about,
        // but it is definitely not a send either.
        return error?.name === 'AbortError' ? 'ready' : 'failed';
    }
};

/**
 * Copy the message to the clipboard.
 * @param {string} message
 * @returns {Promise<DeliveryStatus>}
 */
export const copyAlert = async (message) => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(message);
            return 'copied';
        }
    } catch {
        // Fall through to the legacy path below.
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = message;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok ? 'copied' : 'failed';
    } catch {
        return 'failed';
    }
};

/**
 * Plain-language wording for a delivery status. Never implies confirmed receipt.
 * @param {DeliveryStatus} status
 * @returns {string}
 */
export const describeStatus = (status) => ({
    ready: 'Ready to send',
    opened: 'Message opened — check it was sent',
    shared: 'Passed to the share sheet',
    copied: 'Copied — paste it anywhere',
    failed: "Couldn't open — copy the message instead",
}[status] ?? 'Ready to send');

/**
 * Overall, honest summary of an alert's state.
 * @param {Object} alert
 * @returns {{ headline: string, detail: string, allHandled: boolean }}
 */
export const summariseAlert = (alert) => {
    const recipients = alert?.recipients ?? [];
    if (recipients.length === 0) {
        return {
            headline: 'No contacts saved',
            detail: 'Add an emergency contact so SafeSignal has someone to reach.',
            allHandled: false,
        };
    }

    const handled = recipients.filter((r) => r.status !== 'ready' && r.status !== 'failed');

    if (handled.length === 0) {
        return {
            headline: 'Your alert is ready',
            detail: 'Tap a contact below to open a pre-written message. Nothing has been sent yet.',
            allHandled: false,
        };
    }

    if (handled.length < recipients.length) {
        return {
            headline: `${handled.length} of ${recipients.length} contacts opened`,
            detail: 'Check each message actually sent, then reach the rest.',
            allHandled: false,
        };
    }

    return {
        headline: 'All messages opened',
        detail: 'Confirm each one was sent from your messaging app.',
        allHandled: true,
    };
};
