/**
 * Audio Capture Module
 * Handles microphone initialization at 16kHz mono
 */

let audioContext = null;
let audioStream = null;
let analyserNode = null;
let sourceNode = null;

/**
 * Initialize audio capture at 16kHz mono
 * @returns {Promise<{context: AudioContext, stream: MediaStream, analyser: AnalyserNode}>}
 */
export const initAudioCapture = async () => {
    try {
        // Request microphone access
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1, // Mono
                sampleRate: 16000, // 16kHz
                echoCancellation: true,
                noiseSuppression: false, // We'll do custom noise reduction
                autoGainControl: false,
            },
        });

        // Create AudioContext at 16kHz
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000,
        });

        // Create source node from stream
        sourceNode = audioContext.createMediaStreamSource(audioStream);

        // Create analyser for FFT and waveform
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0;

        // Connect source to analyzer
        sourceNode.connect(analyserNode);

        console.log('🎤 Audio capture initialized at 16kHz mono');

        return {
            context: audioContext,
            stream: audioStream,
            analyser: analyserNode,
            source: sourceNode,
        };
    } catch (error) {
        console.error('Failed to initialize audio capture:', error);
        throw new Error('Microphone access denied or not available');
    }
};

/**
 * Get audio stream
 * @returns {MediaStream | null}
 */
export const getAudioStream = () => {
    return audioStream;
};

/**
 * Get audio context
 * @returns {AudioContext | null}
 */
export const getAudioContext = () => {
    return audioContext;
};

/**
 * Get analyser node for FFT/waveform
 * @returns {AnalyserNode | null}
 */
export const getAnalyserNode = () => {
    return analyserNode;
};

/**
 * Get current sample rate
 * @returns {number}
 */
export const getSampleRate = () => {
    return audioContext ? audioContext.sampleRate : 16000;
};

/**
 * Release audio resources
 */
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
        audioContext.close();
        audioContext = null;
    }

    console.log('🔇 Audio capture released');
};

/**
 * Check if audio capture is active
 * @returns {boolean}
 */
export const isAudioActive = () => {
    return audioContext !== null && audioContext.state === 'running';
};
