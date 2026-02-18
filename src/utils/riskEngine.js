// Risk Engine - Simulates multi-sensor risk detection

/**
 * Calculate weighted risk score based on sensor inputs
 * @param {number} gestureScore - 0 or 1 (detected or not)
 * @param {number} stressScore - 0-1 (voice stress level)
 * @param {number} motionScore - 0-1 (unusual motion patterns)
 * @returns {number} - Combined risk score 0-1
 */
export const calculateRisk = (gestureScore, stressScore, motionScore) => {
    const weights = {
        gesture: 0.5,
        stress: 0.3,
        motion: 0.2,
    };

    const riskScore =
        gestureScore * weights.gesture +
        stressScore * weights.stress +
        motionScore * weights.motion;

    return Math.min(Math.max(riskScore, 0), 1); // Clamp between 0-1
};

/**
 * Simulate gesture detection (mock for demo)
 * In production, this would use MediaPipe or TensorFlow.js
 * @returns {number} - 0 or 1
 */
export const detectGesture = () => {
    // For demo: random chance of distress gesture
    return Math.random() > 0.95 ? 1 : 0;
};

/**
 * Simulate stress detection from audio (mock for demo)
 * NOTE: Real audio stress detection is now in src/utils/audio/audioPipeline.js
 * This function is kept for backward compatibility but will be replaced by real detection
 * @returns {number} - 0-1
 */
export const detectStress = () => {
    // This is now handled by the audio pipeline
    // See: audioPipeline.js, stressInference.js
    // For backward compatibility, return low baseline
    return Math.random() * 0.3; // Low baseline stress
};

/**
 * Simulate motion detection (mock for demo)
 * In production, this would use accelerometer/gyroscope
 * @returns {number} - 0-1
 */
export const detectMotion = () => {
    // For demo: random motion score
    return Math.random() * 0.2; // Low baseline motion
};

/**
 * Get risk level label based on score
 * @param {number} riskScore - 0-1
 * @returns {string} - 'safe', 'moderate', or 'danger'
 */
export const getRiskLevel = (riskScore) => {
    if (riskScore < 0.3) return 'safe';
    if (riskScore < 0.75) return 'moderate';
    return 'danger';
};

/**
 * Get color based on risk level
 * @param {string} level - 'safe', 'moderate', or 'danger'
 * @returns {string} - CSS color variable
 */
export const getRiskColor = (level) => {
    const colors = {
        safe: 'var(--color-safe)',
        moderate: 'var(--color-warning)',
        danger: 'var(--color-danger)',
    };
    return colors[level] || colors.safe;
};

/**
 * Trigger emergency alert simulation
 * @param {Array} contacts - Emergency contacts
 * @param {Object} location - { lat, lng }
 */
export const triggerEmergency = async (contacts, location) => {
    console.log('🚨 EMERGENCY TRIGGERED');
    console.log('Contacts to notify:', contacts);
    console.log('Location:', location);

    // Simulate data capture
    const emergencyData = {
        timestamp: new Date().toISOString(),
        location: location,
        contacts: contacts,
        // In production: capture audio/image
    };

    // Save to localStorage for demo
    localStorage.setItem('lastEmergency', JSON.stringify(emergencyData));

    return emergencyData;
};
