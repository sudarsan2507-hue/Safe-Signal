/**
 * Small helpers shared by the endpoints.
 */

/**
 * @param {Response} _res
 * @param {number} status
 * @param {Object} body
 * @returns {Response}
 */
export const json = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            // The app is served from the same origin; nothing here is meant to
            // be callable from another site.
            'Cache-Control': 'no-store',
        },
    });

/**
 * Parse a JSON body without throwing on malformed input.
 *
 * @param {Request} request
 * @returns {Promise<Object|null>}
 */
export const readJson = async (request) => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

/**
 * Reject anything that is not the expected method.
 *
 * @param {Request} request
 * @param {string} method
 * @returns {Response|null}
 */
export const requireMethod = (request, method) =>
    request.method === method ? null : json(405, { error: `Use ${method}.` });
