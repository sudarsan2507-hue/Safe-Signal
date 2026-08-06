/**
 * What a contact hears and reads when a check-in is missed.
 *
 * Composed server-side rather than trusting whatever the client stored, so a
 * tampered record cannot turn the alert into a vehicle for arbitrary text read
 * aloud down a phone line.
 */

/** Longest free-text note we will repeat back. */
const MAX_NOTE = 140;

/**
 * Strip anything that would break out of the surrounding markup or carry
 * control characters into a text-to-speech engine.
 *
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export const sanitiseText = (value, maxLength = MAX_NOTE) =>
    String(value ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[<>&"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);

/**
 * @param {{ lat: number, lng: number }|null} location
 * @returns {string}
 */
export const mapsLink = (location) =>
    location ? `https://www.google.com/maps?q=${location.lat},${location.lng}` : '';

/**
 * The words spoken when the call connects.
 *
 * Deliberately slow and repetitive: someone woken by an unknown number at 2am
 * needs the essential fact stated twice, not a paragraph delivered once.
 *
 * @param {Object} record
 * @returns {string}
 */
export const buildSpokenMessage = (record) => {
    const who = sanitiseText(record.userName, 40) || 'Someone';
    const note = sanitiseText(record.note);

    const parts = [
        `This is an automated safety alert from Safe Signal.`,
        `${who} set a check-in timer and did not confirm they were safe.`,
    ];

    if (note) parts.push(`They said they were: ${note}.`);

    parts.push(
        record.location
            ? 'Their last known location has been sent to you by text message.'
            : 'Their location was not available.',
    );
    parts.push(`Again: ${who} may need help. Please try to contact them.`);

    return parts.join(' ');
};

/**
 * TwiML for a spoken call.
 *
 * @param {Object} record
 * @returns {string}
 */
export const buildTwiml = (record) => {
    const spoken = buildSpokenMessage(record);
    // Said twice, with a pause: the first seconds of an unexpected call are
    // usually spent working out what it is.
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Response>',
        `<Say voice="alice">${spoken}</Say>`,
        '<Pause length="1"/>',
        `<Say voice="alice">${spoken}</Say>`,
        '</Response>',
    ].join('');
};

/**
 * The accompanying text message, which carries the detail a call cannot.
 *
 * @param {Object} record
 * @returns {string}
 */
export const buildTextMessage = (record) => {
    const who = sanitiseText(record.userName, 40) || 'Someone using SafeSignal';
    const note = sanitiseText(record.note);
    const due = new Date(record.expiresAt).toLocaleString();

    const lines = [`${who} did not check in by ${due} and may need help.`];

    if (note) lines.push(`They said: ${note}`);

    if (record.location) {
        lines.push(`Last known location: ${mapsLink(record.location)}`);
        if (Number.isFinite(record.location.accuracy)) {
            const metres = Math.round(record.location.accuracy);
            lines.push(
                metres > 2000
                    ? `(WARNING: only a rough estimate — could be anywhere within ${Math.round(metres / 1000)} km.)`
                    : `(accurate to about ${metres} m)`,
            );
        }
    } else {
        lines.push('Their location was not available.');
    }

    lines.push('Sent automatically by SafeSignal.');
    return lines.join('\n');
};
