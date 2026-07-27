/**
 * Audio Capture Module
 * Requests a mono microphone stream and exposes an AnalyserNode for analysis.
 *
 * The analyser buffer is deliberately large: the pipeline polls it every
 * POLL_INTERVAL_MS, and getFloatTimeDomainData only ever returns the most
 * recent `fftSize` samples. If fftSize covered less time than the poll
 * interval, the gap between polls would simply never be analysed. Sizing the
 * buffer to cover at least one full poll interval keeps coverage continuous.
 */

/** How often the pipeline polls the analyser (kept in sync with audioPipeline) */
export const POLL_INTERVAL_MS = 500;

/** Preferred capture rate. Browsers may ignore this and pick their own. */
const PREFERRED_SAMPLE_RATE = 16000;

let audioContext = null;
let audioStream = null;
let analyserNode = null;
let sourceNode = null;

/**
 * Choose an fftSize (power of two) whose duration covers the poll interval.
 * @param {number} sampleRate
 * @returns {number} fftSize between 2048 and 32768
 */
const chooseFftSize = (sampleRate) => {
    const needed = (sampleRate * POLL_INTERVAL_MS) / 1000;
    let size = 2048;
    while (size < needed && size < 32768) size *= 2;
    return size;
};

/**
 * Initialize microphone capture.
 * @returns {Promise<{context: AudioContext, stream: MediaStream, analyser: AnalyserNode, sampleRate: number}>}
 */
export const initAudioCapture = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot access the microphone.');
    }

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: PREFERRED_SAMPLE_RATE,
                echoCancellation: true,
                // Browser noise suppression would flatten the very features we
                // measure (spectral shape, energy dynamics), so we opt out and
                // handle noise ourselves.
                noiseSuppression: false,
                autoGainControl: false,
            },
        });

        const Ctor = window.AudioContext || window.webkitAudioContext;
        try {
            audioContext = new Ctor({ sampleRate: PREFERRED_SAMPLE_RATE });
        } catch {
            // Some browsers reject an explicit sampleRate — fall back to default.
            audioContext = new Ctor();
        }

        // Autoplay policies can start the context suspended.
        if (audioContext.state === 'suspended') {
            await audioContext.resume().catch(() => { });
        }

        sourceNode = audioContext.createMediaStreamSource(audioStream);

        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = chooseFftSize(audioContext.sampleRate);
        analyserNode.smoothingTimeConstant = 0;

        sourceNode.connect(analyserNode);

        return {
            context: audioContext,
            stream: audioStream,
            analyser: analyserNode,
            source: sourceNode,
            sampleRate: audioContext.sampleRate,
        };
    } catch (error) {
        releaseAudioCapture();
        if (error?.name === 'NotAllowedError') {
            throw new Error('Microphone permission was denied.');
        }
        if (error?.name === 'NotFoundError') {
            throw new Error('No microphone was found on this device.');
        }
        throw new Error('The microphone could not be started.');
    }
};

/** @returns {MediaStream | null} */
export const getAudioStream = () => audioStream;

/** @returns {AudioContext | null} */
export const getAudioContext = () => audioContext;

/** @returns {AnalyserNode | null} */
export const getAnalyserNode = () => analyserNode;

/** @returns {number} The real capture sample rate (not the requested one) */
export const getSampleRate = () => (audioContext ? audioContext.sampleRate : PREFERRED_SAMPLE_RATE);

/** Stop the microphone and tear down the audio graph. */
export const releaseAudioCapture = () => {
    if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
        audioStream = null;
    }
    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (analyserNode) {
        analyserNode.disconnect();
        analyserNode = null;
    }
    if (audioContext) {
        audioContext.close().catch(() => { });
        audioContext = null;
    }
};

/** @returns {boolean} */
export const isAudioActive = () => audioContext !== null && audioContext.state === 'running';
