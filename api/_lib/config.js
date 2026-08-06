/**
 * Backend configuration.
 *
 * Everything here is optional. With nothing set, the API refuses to register a
 * check-in and the app falls back to its on-device timer — which is the correct
 * behaviour, because a half-configured backend that accepts a check-in and then
 * cannot reach anyone is worse than no backend at all.
 *
 * Files under api/_lib are not routed by Vercel; the leading underscore keeps
 * them out of the public surface.
 */

/**
 * @param {string} name
 * @returns {string}
 */
const env = (name) => (process.env[name] ?? '').trim();

export const config = {
    baseUrl: env('PUBLIC_BASE_URL').replace(/\/+$/, ''),
    signingSecret: env('CHECKIN_SIGNING_SECRET'),

    redis: {
        url: env('UPSTASH_REDIS_REST_URL').replace(/\/+$/, ''),
        token: env('UPSTASH_REDIS_REST_TOKEN'),
    },

    qstash: {
        token: env('QSTASH_TOKEN'),
    },

    provider: env('MESSAGING_PROVIDER') || 'console',

    twilio: {
        accountSid: env('TWILIO_ACCOUNT_SID'),
        authToken: env('TWILIO_AUTH_TOKEN'),
        from: env('TWILIO_FROM_NUMBER'),
    },

    exotel: {
        accountSid: env('EXOTEL_ACCOUNT_SID'),
        apiKey: env('EXOTEL_API_KEY'),
        apiToken: env('EXOTEL_API_TOKEN'),
        callerId: env('EXOTEL_CALLER_ID'),
        flowUrl: env('EXOTEL_FLOW_URL'),
    },
};

/**
 * Which required pieces are missing, named so a misconfiguration is diagnosable
 * from the response rather than from a stack trace.
 *
 * @returns {string[]}
 */
export const missingConfig = () => {
    const missing = [];
    if (!config.baseUrl) missing.push('PUBLIC_BASE_URL');
    if (!config.signingSecret) missing.push('CHECKIN_SIGNING_SECRET');
    if (!config.redis.url) missing.push('UPSTASH_REDIS_REST_URL');
    if (!config.redis.token) missing.push('UPSTASH_REDIS_REST_TOKEN');
    if (!config.qstash.token) missing.push('QSTASH_TOKEN');
    return missing;
};

/** @returns {boolean} */
export const isConfigured = () => missingConfig().length === 0;

/**
 * A signing secret shorter than this is not worth having.
 * @returns {boolean}
 */
export const hasUsableSecret = () => config.signingSecret.length >= 32;
