/**
 * Console provider — logs instead of dialling.
 *
 * The default, deliberately. A deployment with credentials half-filled should
 * print what it *would* have done rather than fail silently, and no test run
 * should ever ring a real person by accident.
 */

/**
 * @param {{ to: string, record: Object, twiml: string }} params
 * @returns {Promise<{ ok: true, id: string, simulated: true }>}
 */
export const placeCall = async ({ to, twiml }) => {
    console.log('[SafeSignal] would call', to, '\n', twiml);
    return { ok: true, id: `console-call-${Date.now()}`, simulated: true };
};

/**
 * @param {{ to: string, body: string }} params
 * @returns {Promise<{ ok: true, id: string, simulated: true }>}
 */
export const sendText = async ({ to, body }) => {
    console.log('[SafeSignal] would text', to, '\n', body);
    return { ok: true, id: `console-sms-${Date.now()}`, simulated: true };
};

export const name = 'console';
