/**
 * Per-check-in tokens.
 *
 * Every check-in gets a random id and a token derived from it by HMAC. Only the
 * id is stored; the token is returned once and held by the client.
 *
 * This is not decoration. Without it, anyone who could guess or enumerate an id
 * could cancel somebody else's safety timer — an attack that would leave the
 * victim believing they were being watched over when they were not. Guessing is
 * made infeasible by a 128-bit random id, and cancelling additionally requires a
 * token that cannot be derived without the server secret.
 */

import { config } from './config.js';

/** @returns {string} 128 bits of randomness, hex encoded */
export const createId = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
const toHex = (buffer) =>
    [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Derive the token for a check-in id.
 *
 * @param {string} id
 * @returns {Promise<string>}
 */
export const signId = async (id) => {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(config.signingSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id));
    return toHex(signature);
};

/**
 * Compare two strings without leaking their difference through timing.
 *
 * A plain === returns as soon as it finds a mismatched character, which lets an
 * attacker recover a token byte by byte from response latency.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export const constantTimeEqual = (a, b) => {
    const left = String(a ?? '');
    const right = String(b ?? '');
    if (left.length !== right.length) return false;

    let difference = 0;
    for (let i = 0; i < left.length; i++) {
        difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
    }
    return difference === 0;
};

/**
 * @param {string} id
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export const verifyToken = async (id, token) => {
    if (!id || !token) return false;
    const expected = await signId(id);
    return constantTimeEqual(expected, token);
};
