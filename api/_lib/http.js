/**
 * Small helpers shared by the endpoints.
 *
 * These use Node's (req, res) signature rather than Web-standard Request and
 * Response. That distinction is load-bearing: Vercel's Node runtime hands the
 * handler Node objects and ignores any Response it returns, so a Web-style
 * handler never actually replies and the request hangs until the gateway times
 * it out. The failure gives no error and no log — the endpoint simply stops
 * answering, which is a miserable thing to debug.
 *
 * Buffer is also needed for the providers' Basic auth headers, which the Edge
 * runtime does not provide, so Node is the right choice here regardless.
 */

/**
 * Send a JSON response.
 *
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {Object} body
 */
export const sendJson = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
};

/**
 * Read a JSON body without throwing on malformed input.
 *
 * Vercel parses JSON bodies into req.body, but that is not guaranteed for every
 * content type or local runner, so a raw stream is handled too.
 *
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @returns {Promise<Object|null>}
 */
export const readJsonBody = async (req) => {
    if (req.body && typeof req.body === 'object') return req.body;

    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            return null;
        }
    }

    try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        if (chunks.length === 0) return null;
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        return null;
    }
};

/**
 * Reject anything that is not the expected method.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} method
 * @returns {boolean} true if the request was rejected and already answered
 */
export const rejectWrongMethod = (req, res, method) => {
    if (req.method === method) return false;
    res.setHeader('Allow', method);
    sendJson(res, 405, { error: `Use ${method}.` });
    return true;
};
