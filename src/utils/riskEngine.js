/**
 * Risk Engine
 * Fuses the available sensors into a single 0–1 risk score and decides when
 * that risk has been sustained long enough to warrant raising an alert.
 *
 * Two design rules matter here:
 *
 *  1. Weights are renormalised across the sensors that are actually running.
 *     With fixed weights, a device with only a camera could reach at most 0.5
 *     and a device with only a microphone at most 0.3 — both permanently below
 *     the 0.75 threshold, so no alert could ever fire no matter what happened.
 *
 *  2. A high score alone is not enough to escalate. Either the deliberate hand
 *     signal is confirmed, or two independent sensors must agree. One noisy
 *     sensor should never be able to summon help on its own.
 */

/** Relative importance of each sensor when all are available. */
export const SENSOR_WEIGHTS = {
    gesture: 0.5,
    stress: 0.3,
    motion: 0.2,
};

/** Score at or above which the situation counts as critical. */
export const RISK_THRESHOLD = 0.75;

/** Score at or above which the UI shows a raised, but not critical, state. */
export const ELEVATED_THRESHOLD = 0.3;

/** How long risk must stay critical before the countdown begins. */
export const SUSTAIN_DURATION_MS = 5000;

/** Per-sensor level that counts as that sensor "raising a concern". */
export const CONCERN_THRESHOLD = 0.6;

/**
 * @typedef {Object} SensorReadings
 * @property {number} gesture - 0 or 1, the confirmed distress hand signal
 * @property {number} stress  - 0–1 vocal stress
 * @property {number} motion  - 0–1 movement abnormality
 */

/**
 * @typedef {Object} SensorAvailability
 * @property {boolean} gesture
 * @property {boolean} stress
 * @property {boolean} motion
 */

/**
 * Combine sensor readings into a single risk score.
 *
 * @param {SensorReadings} readings
 * @param {SensorAvailability} availability
 * @returns {{ score: number, contributions: Object, activeSensors: string[], coverage: number }}
 */
export const calculateRisk = (readings, availability) => {
    const active = Object.keys(SENSOR_WEIGHTS).filter((key) => availability?.[key]);

    if (active.length === 0) {
        return { score: 0, contributions: {}, activeSensors: [], coverage: 0 };
    }

    const totalWeight = active.reduce((sum, key) => sum + SENSOR_WEIGHTS[key], 0);
    const allWeight = Object.values(SENSOR_WEIGHTS).reduce((a, b) => a + b, 0);

    const contributions = {};
    let score = 0;

    for (const key of active) {
        const value = clamp01(readings?.[key] ?? 0);
        const normalisedWeight = SENSOR_WEIGHTS[key] / totalWeight;
        const contribution = value * normalisedWeight;
        contributions[key] = { value, weight: normalisedWeight, contribution };
        score += contribution;
    }

    return {
        score: clamp01(score),
        contributions,
        activeSensors: active,
        // How much of the full sensor suite is running — shown to the user so
        // a partially-equipped device does not look like a fully covered one.
        coverage: totalWeight / allWeight,
    };
};

/**
 * Decide whether the reading pattern is corroborated well enough to escalate.
 *
 * @param {SensorReadings} readings
 * @param {SensorAvailability} availability
 * @returns {{ corroborated: boolean, reason: string|null, concerned: string[] }}
 */
export const evaluateCorroboration = (readings, availability) => {
    if (availability?.gesture && readings?.gesture >= 1) {
        return {
            corroborated: true,
            reason: 'You held the distress hand signal',
            concerned: ['gesture'],
        };
    }

    const concerned = Object.keys(SENSOR_WEIGHTS).filter(
        (key) => availability?.[key] && (readings?.[key] ?? 0) >= CONCERN_THRESHOLD,
    );

    if (concerned.length >= 2) {
        return {
            corroborated: true,
            reason: 'Several signs of distress at once',
            concerned,
        };
    }

    return { corroborated: false, reason: null, concerned };
};

/**
 * Tracks how long risk has been continuously critical.
 *
 * Kept as an explicit state machine rather than a setTimeout, because a timeout
 * handle stored on a ref is easy to clear without clearing the ref — which
 * silently prevents the timer from ever being re-armed.
 */
export class RiskTracker {
    /**
     * @param {number} sustainMs
     * @param {number} threshold
     */
    constructor(sustainMs = SUSTAIN_DURATION_MS, threshold = RISK_THRESHOLD) {
        this.sustainMs = sustainMs;
        this.threshold = threshold;
        this.criticalSince = null;
        this.hasEscalated = false;
    }

    /**
     * Feed one set of readings.
     *
     * @param {SensorReadings} readings
     * @param {SensorAvailability} availability
     * @param {number} now - timestamp in ms
     * @returns {Object} full evaluation, including whether to escalate now
     */
    update(readings, availability, now = Date.now()) {
        const risk = calculateRisk(readings, availability);
        const corroboration = evaluateCorroboration(readings, availability);

        const qualifies = risk.score >= this.threshold && corroboration.corroborated;

        if (qualifies) {
            if (this.criticalSince === null) this.criticalSince = now;
        } else {
            this.criticalSince = null;
            this.hasEscalated = false;
        }

        const sustainedMs = this.criticalSince === null ? 0 : now - this.criticalSince;
        const sustainProgress = Math.min(sustainedMs / this.sustainMs, 1);

        let shouldEscalate = false;
        if (qualifies && sustainedMs >= this.sustainMs && !this.hasEscalated) {
            shouldEscalate = true;
            this.hasEscalated = true;
        }

        return {
            ...risk,
            level: getRiskLevel(risk.score),
            corroborated: corroboration.corroborated,
            escalationReason: corroboration.reason,
            concernedSensors: corroboration.concerned,
            sustainedMs,
            sustainProgress,
            shouldEscalate,
        };
    }

    /** Clear sustain state, e.g. after the user cancels. */
    reset() {
        this.criticalSince = null;
        this.hasEscalated = false;
    }
}

/**
 * @param {number} riskScore
 * @returns {'safe'|'elevated'|'critical'}
 */
export const getRiskLevel = (riskScore) => {
    if (riskScore < ELEVATED_THRESHOLD) return 'safe';
    if (riskScore < RISK_THRESHOLD) return 'elevated';
    return 'critical';
};

/**
 * Short status word shown alongside the icon, so the state is never conveyed
 * by colour alone.
 * @param {'safe'|'elevated'|'critical'} level
 * @returns {string}
 */
export const getRiskLabel = (level) => ({
    safe: 'All clear',
    elevated: 'Keeping a closer eye',
    critical: 'Checking on you',
}[level] ?? 'All clear');

/**
 * Reassuring, plain-language explanation of the current state.
 * @param {'safe'|'elevated'|'critical'} level
 * @param {boolean} isWatching
 * @returns {string}
 */
export const getRiskDescription = (level, isWatching) => {
    if (!isWatching) return 'Protection is off. Turn it on when you want SafeSignal watching.';
    return {
        safe: 'Everything looks normal. SafeSignal is quietly watching.',
        elevated: 'Something changed slightly. No alert yet — just paying attention.',
        critical: 'This looks like it could be an emergency. You can stop it at any time.',
    }[level] ?? 'SafeSignal is watching.';
};

/**
 * @param {'safe'|'elevated'|'critical'} level
 * @returns {string} CSS custom property reference
 */
export const getRiskColor = (level) => ({
    safe: 'var(--risk-safe)',
    elevated: 'var(--risk-elevated)',
    critical: 'var(--risk-critical)',
}[level] ?? 'var(--risk-safe)');

/**
 * @param {number} value
 * @returns {number}
 */
const clamp01 = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(value, 0), 1);
};
