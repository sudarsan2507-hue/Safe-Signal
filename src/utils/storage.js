/**
 * Storage helpers.
 *
 * localStorage throws in private-browsing modes and when quota is exceeded,
 * and any stored JSON can be corrupted or hand-edited. For an app whose whole
 * job is to work at the worst possible moment, every read is defensive and
 * every write reports whether it actually succeeded.
 */

export const CONTACTS_KEY = 'safesignal.contacts';
export const PERMISSIONS_KEY = 'safesignal.permissions';
export const LAST_ALERT_KEY = 'safesignal.lastAlert';

/** Legacy keys from earlier builds, migrated on first read. */
const LEGACY_CONTACTS_KEY = 'emergencyContacts';
const LEGACY_ALERT_KEY = 'lastEmergency';

/**
 * @returns {boolean} whether localStorage is usable in this context
 */
export const isStorageAvailable = () => {
    try {
        const probe = '__safesignal_probe__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return true;
    } catch {
        return false;
    }
};

/**
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
export const readJSON = (key, fallback = null) => {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
};

/**
 * @param {string} key
 * @param {*} value
 * @returns {boolean} whether the write succeeded
 */
export const writeJSON = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
};

/**
 * @param {string} key
 */
export const removeKey = (key) => {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Nothing useful to do if removal fails.
    }
};

/**
 * A contact record.
 * @typedef {{ id: string, name: string, phone: string }} Contact
 */

/**
 * Read contacts, discarding malformed entries rather than crashing on them.
 * @returns {Contact[]}
 */
export const loadContacts = () => {
    let raw = readJSON(CONTACTS_KEY, null);

    if (raw === null) {
        const legacy = readJSON(LEGACY_CONTACTS_KEY, null);
        if (Array.isArray(legacy)) {
            raw = legacy;
            writeJSON(CONTACTS_KEY, legacy);
            removeKey(LEGACY_CONTACTS_KEY);
        }
    }

    if (!Array.isArray(raw)) return [];

    return raw
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
            id: String(c.id ?? crypto.randomUUID?.() ?? Date.now() + Math.random()),
            name: typeof c.name === 'string' ? c.name : '',
            phone: typeof c.phone === 'string' ? c.phone : '',
        }))
        .filter((c) => c.name.trim() !== '' && c.phone.trim() !== '');
};

/**
 * @param {Contact[]} contacts
 * @returns {boolean} whether the save succeeded
 */
export const saveContacts = (contacts) => writeJSON(CONTACTS_KEY, contacts);

/**
 * @returns {Object|null}
 */
export const loadLastAlert = () => readJSON(LAST_ALERT_KEY, null) ?? readJSON(LEGACY_ALERT_KEY, null);

/**
 * @param {Object} alert
 * @returns {boolean}
 */
export const saveLastAlert = (alert) => writeJSON(LAST_ALERT_KEY, alert);

/**
 * @returns {{camera: boolean, microphone: boolean, location: boolean, motion: boolean}}
 */
export const loadPermissions = () => {
    const stored = readJSON(PERMISSIONS_KEY, null);
    return {
        camera: Boolean(stored?.camera),
        microphone: Boolean(stored?.microphone),
        location: Boolean(stored?.location),
        motion: Boolean(stored?.motion),
    };
};

/**
 * @param {Object} permissions
 * @returns {boolean}
 */
export const savePermissions = (permissions) => writeJSON(PERMISSIONS_KEY, permissions);
