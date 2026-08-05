/**
 * Incident log — what the sensors saw, and why the threshold was crossed.
 *
 * This answers "why was this message sent?" without recording anything. It
 * holds numbers and timestamps only: no audio, no video, no frames. The app's
 * promise that nothing is recorded stays literally true, and a log this small
 * is more use than footage anyway — one line states what a viewer would have to
 * infer from thirty seconds of dark, shaky video.
 *
 * The buffer is bounded and in memory. It is written to storage only when an
 * alert is raised, attached to that alert.
 */

/** Entries retained in the ring buffer (~4 minutes at one reading per second). */
export const MAX_ENTRIES = 240;

/** How much history is attached to an alert. */
export const SNAPSHOT_WINDOW_MS = 60_000;

/**
 * Event kinds. READING is the periodic sensor sample; the rest are moments.
 */
export const EVENT = {
    READING: 'reading',
    PROTECTION_ON: 'protection-on',
    PROTECTION_OFF: 'protection-off',
    SENSOR_ON: 'sensor-on',
    SENSOR_OFF: 'sensor-off',
    SUSTAIN_STARTED: 'sustain-started',
    SUSTAIN_RESET: 'sustain-reset',
    COUNTDOWN_STARTED: 'countdown-started',
    COUNTDOWN_CANCELLED: 'countdown-cancelled',
    ALERT_RAISED: 'alert-raised',
    CHECKIN_STARTED: 'checkin-started',
    CHECKIN_MISSED: 'checkin-missed',
    MANUAL_ALERT: 'manual-alert',
};

export class IncidentLog {
    /**
     * @param {number} maxEntries
     */
    constructor(maxEntries = MAX_ENTRIES) {
        this.maxEntries = maxEntries;
        this.entries = [];
    }

    /**
     * @param {string} type - one of EVENT
     * @param {Object} data
     * @param {number} now
     */
    record(type, data = {}, now = Date.now()) {
        this.entries.push({ t: now, type, ...data });
        if (this.entries.length > this.maxEntries) {
            this.entries.splice(0, this.entries.length - this.maxEntries);
        }
    }

    /**
     * Entries from the recent past, oldest first.
     * @param {number} windowMs
     * @param {number} now
     * @returns {Array}
     */
    snapshot(windowMs = SNAPSHOT_WINDOW_MS, now = Date.now()) {
        const cutoff = now - windowMs;
        return this.entries.filter((entry) => entry.t >= cutoff);
    }

    clear() {
        this.entries = [];
    }

    /** @returns {Array} */
    getEntries() {
        return this.entries;
    }
}

/**
 * Condense a snapshot into the facts worth showing.
 *
 * Readings are summarised rather than listed — sixty rows of near-identical
 * numbers is not an explanation.
 *
 * @param {Array} entries
 * @returns {{peakRisk: number, peakReadings: Object|null, activeSensors: string[], moments: Array, durationMs: number}}
 */
export const summariseSnapshot = (entries) => {
    const empty = {
        peakRisk: 0,
        peakReadings: null,
        activeSensors: [],
        moments: [],
        durationMs: 0,
    };

    if (!entries || entries.length === 0) return empty;

    const readings = entries.filter((e) => e.type === EVENT.READING);
    const moments = entries.filter((e) => e.type !== EVENT.READING);

    let peak = null;
    for (const reading of readings) {
        if (!peak || (reading.risk ?? 0) > (peak.risk ?? 0)) peak = reading;
    }

    const sensors = new Set();
    for (const reading of readings) {
        for (const name of reading.active ?? []) sensors.add(name);
    }

    return {
        peakRisk: peak?.risk ?? 0,
        peakReadings: peak?.readings ?? null,
        activeSensors: [...sensors],
        moments,
        durationMs: entries[entries.length - 1].t - entries[0].t,
    };
};

/** Plain-language names for the sensors. */
const SENSOR_LABEL = {
    gesture: 'hand signal',
    stress: 'voice tension',
    motion: 'movement',
};

/**
 * One sentence naming what actually drove the alert, suitable for an SMS.
 *
 * @param {Array} entries
 * @param {string|null} reason
 * @returns {string}
 */
export const summariseTrigger = (entries, reason = null) => {
    const summary = summariseSnapshot(entries);

    if (!summary.peakReadings) {
        return reason ?? 'Alert raised manually.';
    }

    const parts = [];
    for (const [key, value] of Object.entries(summary.peakReadings)) {
        const label = SENSOR_LABEL[key] ?? key;
        if (key === 'gesture') {
            if (value >= 1) parts.push('distress hand signal held');
        } else if (value > 0) {
            parts.push(`${label} ${Math.round(value * 100)}%`);
        }
    }

    if (parts.length === 0) return reason ?? 'Alert raised.';
    return `Detected: ${parts.join(', ')}.`;
};

/**
 * Human-readable line for a single logged moment.
 * @param {Object} entry
 * @returns {string}
 */
export const describeMoment = (entry) => {
    switch (entry.type) {
        case EVENT.PROTECTION_ON:
            return 'Protection turned on';
        case EVENT.PROTECTION_OFF:
            return 'Protection turned off';
        case EVENT.SENSOR_ON:
            return `${SENSOR_LABEL[entry.sensor] ?? entry.sensor} enabled`;
        case EVENT.SENSOR_OFF:
            return `${SENSOR_LABEL[entry.sensor] ?? entry.sensor} disabled`;
        case EVENT.SUSTAIN_STARTED:
            return `Risk crossed the threshold (${formatRisk(entry.risk)})`;
        case EVENT.SUSTAIN_RESET:
            return 'Risk fell back below the threshold';
        case EVENT.COUNTDOWN_STARTED:
            return entry.reason
                ? `Countdown started — ${entry.reason}`
                : 'Countdown started';
        case EVENT.COUNTDOWN_CANCELLED:
            return 'You stopped the alert';
        case EVENT.MANUAL_ALERT:
            return 'You asked for help';
        case EVENT.CHECKIN_STARTED:
            return 'Check-in timer started';
        case EVENT.CHECKIN_MISSED:
            return 'Check-in was missed';
        case EVENT.ALERT_RAISED:
            return 'Alert prepared';
        default:
            return entry.type;
    }
};

/**
 * @param {number} risk
 * @returns {string}
 */
export const formatRisk = (risk) => `${Math.round((risk ?? 0) * 100)}%`;

/**
 * @param {number} timestamp
 * @returns {string}
 */
export const formatTime = (timestamp) =>
    new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let logInstance = null;

/** @returns {IncidentLog} */
export const getIncidentLog = () => {
    if (!logInstance) logInstance = new IncidentLog();
    return logInstance;
};

export const resetIncidentLog = () => {
    logInstance?.clear();
    logInstance = null;
};
