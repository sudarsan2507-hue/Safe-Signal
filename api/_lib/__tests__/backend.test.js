import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

// The token module reads config at call time, so the secret must exist before
// the modules are imported.
beforeAll(() => {
    process.env.CHECKIN_SIGNING_SECRET = 'a'.repeat(48);
});

const loadTokens = () => import('../tokens.js');
const loadCompose = () => import('../compose.js');
const loadMessenger = () => import('../messenger.js');

describe('tokens', () => {
    it('issues ids with enough entropy to be unguessable', async () => {
        const { createId } = await loadTokens();
        const id = createId();
        expect(id).toMatch(/^[0-9a-f]{32}$/);

        const seen = new Set(Array.from({ length: 500 }, () => createId()));
        expect(seen.size).toBe(500);
    });

    it('derives a stable token for an id', async () => {
        const { signId } = await loadTokens();
        expect(await signId('abc')).toBe(await signId('abc'));
    });

    it('derives different tokens for different ids', async () => {
        const { signId } = await loadTokens();
        expect(await signId('abc')).not.toBe(await signId('abd'));
    });

    it('accepts a correct token and rejects a wrong one', async () => {
        // Without this check, anyone guessing an id could cancel someone
        // else's safety timer and leave them believing they were covered.
        const { createId, signId, verifyToken } = await loadTokens();
        const id = createId();
        const token = await signId(id);

        expect(await verifyToken(id, token)).toBe(true);
        expect(await verifyToken(id, 'f'.repeat(64))).toBe(false);
        expect(await verifyToken(id, token.slice(0, -1) + '0')).toBe(false);
    });

    it('rejects missing values rather than treating them as valid', async () => {
        const { verifyToken } = await loadTokens();
        expect(await verifyToken('', '')).toBe(false);
        expect(await verifyToken('id', undefined)).toBe(false);
        expect(await verifyToken(undefined, 'token')).toBe(false);
    });

    it('compares in constant time regardless of where strings differ', async () => {
        const { constantTimeEqual } = await loadTokens();
        expect(constantTimeEqual('abcd', 'abcd')).toBe(true);
        expect(constantTimeEqual('abcd', 'abce')).toBe(false);
        expect(constantTimeEqual('abcd', 'zbcd')).toBe(false);
        expect(constantTimeEqual('abcd', 'abcde')).toBe(false);
    });
});

describe('message composition', () => {
    const record = {
        userName: 'Priya',
        note: 'Walking home from the station',
        expiresAt: Date.UTC(2026, 6, 27, 18, 30),
        location: { lat: 10.9894, lng: 76.9598, accuracy: 15 },
        contacts: [{ name: 'Sam', phone: '+919876543210' }],
    };

    it('strips control characters', async () => {
        const { sanitiseText } = await loadCompose();
        const cleaned = sanitiseText("hi\u0000there\u001Fyou\u007F");
        const codes = [...cleaned].map((ch) => ch.charCodeAt(0));
        expect(codes.every((code) => code >= 0x20 && code !== 0x7f)).toBe(true);
    });

    it('neutralises characters that would break out of TwiML', async () => {
        // The note is user input that ends up inside markup read aloud down a
        // phone line, so it must not be able to introduce new instructions.
        const { buildTwiml } = await loadCompose();
        const twiml = buildTwiml({ ...record, note: '</Say><Play>http://evil</Play><Say>' });
        expect(twiml).not.toContain('<Play>');
        expect(twiml.match(/<Say/g)).toHaveLength(2);
    });

    it('caps an over-long note', async () => {
        const { sanitiseText } = await loadCompose();
        expect(sanitiseText('x'.repeat(500)).length).toBe(140);
    });

    it('states the essential fact twice in the spoken message', async () => {
        // Someone woken by an unknown number needs it repeated.
        const { buildSpokenMessage } = await loadCompose();
        const spoken = buildSpokenMessage(record);
        expect(spoken.match(/Priya/g).length).toBeGreaterThanOrEqual(2);
        expect(spoken).toContain('may need help');
    });

    it('includes a maps link in the text when the location is known', async () => {
        const { buildTextMessage } = await loadCompose();
        const text = buildTextMessage(record);
        expect(text).toContain('maps?q=10.9894,76.9598');
        expect(text).toContain('accurate to about 15 m');
    });

    it('says the location is unavailable rather than inventing one', async () => {
        const { buildTextMessage } = await loadCompose();
        const text = buildTextMessage({ ...record, location: null });
        expect(text).toMatch(/location was not available/i);
        expect(text).not.toContain('maps?q=');
    });

    it('warns when the fix is too coarse to act on', async () => {
        const { buildTextMessage } = await loadCompose();
        const text = buildTextMessage({
            ...record,
            location: { lat: 10.98, lng: 76.95, accuracy: 500000 },
        });
        expect(text).toMatch(/WARNING/);
        expect(text).toContain('500 km');
    });

    it('falls back to a neutral name when none was given', async () => {
        const { buildSpokenMessage } = await loadCompose();
        expect(buildSpokenMessage({ ...record, userName: '' })).toContain('Someone');
    });
});

describe('number normalisation', () => {
    it('keeps digits and a leading plus', async () => {
        const { normaliseNumber } = await loadMessenger();
        expect(normaliseNumber('+91 (987) 654-3210')).toBe('+919876543210');
    });

    it('rejects anything too short to be a phone number', async () => {
        // Caught here so it can be reported per contact rather than failing
        // the whole dispatch.
        const { normaliseNumber } = await loadMessenger();
        expect(normaliseNumber('123')).toBeNull();
        expect(normaliseNumber('')).toBeNull();
        expect(normaliseNumber(null)).toBeNull();
    });
});

describe('provider resolution', () => {
    // config.js reads process.env when the module is first evaluated, so the
    // registry has to be reset for a change to take effect.
    const loadFresh = async () => {
        vi.resetModules();
        return import('../messenger.js');
    };

    afterEach(() => {
        delete process.env.MESSAGING_PROVIDER;
        delete process.env.TWILIO_ACCOUNT_SID;
        delete process.env.TWILIO_AUTH_TOKEN;
        delete process.env.TWILIO_FROM_NUMBER;
    });

    it('falls back to logging when the provider is unknown', async () => {
        // Degrading to "logged, not sent" is survivable; crashing and losing
        // the alert is not.
        process.env.MESSAGING_PROVIDER = 'nonsense';
        const { resolveProvider } = await loadFresh();
        const { provider, warning } = resolveProvider();
        expect(provider.name).toBe('console');
        expect(warning).toMatch(/unknown/i);
    });

    it('falls back to logging when a real provider is half-configured', async () => {
        // Half-filled credentials must not look like a working alert path.
        process.env.MESSAGING_PROVIDER = 'twilio';
        process.env.TWILIO_AUTH_TOKEN = 'token';
        process.env.TWILIO_FROM_NUMBER = '+15550000000';
        const { resolveProvider } = await loadFresh();
        const { provider, warning } = resolveProvider();
        expect(provider.name).toBe('console');
        expect(warning).toMatch(/TWILIO_ACCOUNT_SID/);
    });

    it('uses the real provider once it is fully configured', async () => {
        process.env.MESSAGING_PROVIDER = 'twilio';
        process.env.TWILIO_ACCOUNT_SID = 'AC123';
        process.env.TWILIO_AUTH_TOKEN = 'token';
        process.env.TWILIO_FROM_NUMBER = '+15550000000';
        const { resolveProvider } = await loadFresh();
        const { provider, warning } = resolveProvider();
        expect(provider.name).toBe('twilio');
        expect(warning).toBeNull();
    });
});
