import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Handler-shape tests.
 *
 * These exist because of a failure that produced no error and no log: the
 * handlers were first written Web-style, taking a Request and returning a
 * Response, while running on Vercel's Node runtime. That runtime passes
 * (req, res) and discards a returned Response, so the function simply never
 * answered and every request hung until the gateway timed out.
 *
 * Asserting that a handler *writes to res* catches that class of mistake
 * immediately, which reading the code did not.
 */

/**
 * Minimal stand-ins for Node's request and response.
 *
 * @param {{ method?: string, body?: any }} options
 */
const mockReq = ({ method = 'POST', body = {} } = {}) => ({ method, body });

const mockRes = () => {
    const res = {
        statusCode: 0,
        headers: {},
        payload: undefined,
        ended: false,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        end(chunk) {
            this.ended = true;
            try {
                this.payload = JSON.parse(chunk);
            } catch {
                this.payload = chunk;
            }
        },
    };
    return res;
};

const loadHandler = async (path) => {
    vi.resetModules();
    return (await import(path)).default;
};

describe('endpoint contract', () => {
    beforeEach(() => {
        // Unconfigured on purpose: the point is that a handler still answers.
        delete process.env.PUBLIC_BASE_URL;
        delete process.env.CHECKIN_SIGNING_SECRET;
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        delete process.env.QSTASH_TOKEN;
    });

    afterEach(() => {
        vi.resetModules();
    });

    const endpoints = [
        ['start', '../../checkin/start.js'],
        ['safe', '../../checkin/safe.js'],
        ['fire', '../../checkin/fire.js'],
    ];

    for (const [name, path] of endpoints) {
        it(`${name} always writes a response`, async () => {
            const handler = await loadHandler(path);
            const res = mockRes();
            await handler(mockReq(), res);

            // The whole point: a handler that returns without ending the
            // response leaves the request hanging.
            expect(res.ended).toBe(true);
            expect(res.statusCode).toBeGreaterThanOrEqual(200);
        });

        it(`${name} rejects the wrong method with 405`, async () => {
            const handler = await loadHandler(path);
            const res = mockRes();
            await handler(mockReq({ method: 'GET' }), res);

            expect(res.ended).toBe(true);
            expect(res.statusCode).toBe(405);
            expect(res.headers.allow).toBe('POST');
        });

        it(`${name} reports 503 when nothing is configured`, async () => {
            const handler = await loadHandler(path);
            const res = mockRes();
            await handler(mockReq(), res);

            expect(res.statusCode).toBe(503);
            expect(res.payload.error).toMatch(/not configured/i);
        });
    }

    it('start names the missing settings so the failure is diagnosable', async () => {
        const handler = await loadHandler('../../checkin/start.js');
        const res = mockRes();
        await handler(mockReq(), res);

        expect(res.payload.missing).toEqual(
            expect.arrayContaining(['PUBLIC_BASE_URL', 'CHECKIN_SIGNING_SECRET', 'QSTASH_TOKEN']),
        );
    });

    it('start refuses a signing secret that is too short to be useful', async () => {
        process.env.PUBLIC_BASE_URL = 'https://example.test';
        process.env.CHECKIN_SIGNING_SECRET = 'short';
        process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
        process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
        process.env.QSTASH_TOKEN = 'token';

        const handler = await loadHandler('../../checkin/start.js');
        const res = mockRes();
        await handler(mockReq(), res);

        expect(res.statusCode).toBe(503);
        expect(res.payload.error).toMatch(/at least 32 characters/i);
    });
});

describe('request validation once configured', () => {
    beforeEach(() => {
        process.env.PUBLIC_BASE_URL = 'https://example.test';
        process.env.CHECKIN_SIGNING_SECRET = 'a'.repeat(48);
        process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
        process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
        process.env.QSTASH_TOKEN = 'token';
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('rejects a duration outside the allowed range', async () => {
        // Re-checked server-side because a client can send anything.
        const handler = await loadHandler('../../checkin/start.js');

        for (const durationMs of [1000, 13 * 60 * 60 * 1000, 'soon', -5]) {
            const res = mockRes();
            await handler(mockReq({ body: { durationMs, contacts: [{ phone: '+911234567890' }] } }), res);
            expect(res.statusCode).toBe(400);
            expect(res.payload.error).toMatch(/durationMs/);
        }
    });

    it('refuses a check-in with nobody to reach', async () => {
        const handler = await loadHandler('../../checkin/start.js');
        const res = mockRes();
        await handler(mockReq({ body: { durationMs: 300000, contacts: [] } }), res);

        expect(res.statusCode).toBe(400);
        expect(res.payload.error).toMatch(/contact/i);
    });

    it('requires id and token to cancel', async () => {
        const handler = await loadHandler('../../checkin/safe.js');
        const res = mockRes();
        await handler(mockReq({ body: {} }), res);

        expect(res.statusCode).toBe(400);
    });

    it('refuses to cancel with a wrong token, and does not reveal whether the id exists', async () => {
        const handler = await loadHandler('../../checkin/safe.js');
        const res = mockRes();
        await handler(mockReq({ body: { id: 'abc', token: 'wrong' } }), res);

        expect(res.statusCode).toBe(404);
        expect(res.payload.error).toMatch(/no such check-in/i);
    });

    it('refuses to fire with a wrong token', async () => {
        const handler = await loadHandler('../../checkin/fire.js');
        const res = mockRes();
        await handler(mockReq({ body: { id: 'abc', token: 'wrong' } }), res);

        expect(res.statusCode).toBe(403);
    });
});
