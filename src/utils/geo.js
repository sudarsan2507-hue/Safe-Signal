/**
 * Geolocation helpers.
 *
 * There is deliberately no mock-location fallback. Substituting placeholder
 * coordinates when the real fix fails and presenting them as a map link would
 * send help to the wrong place — the single worst thing this app could do.
 * Failures are returned as failures so the UI can say so plainly.
 */

/**
 * @typedef {Object} LocationResult
 * @property {boolean} ok
 * @property {{lat: number, lng: number, accuracy: number, timestamp: number}} [coords]
 * @property {string} [error] - human-readable failure reason
 */

/**
 * Request a single position fix.
 *
 * @param {{timeout?: number, maximumAge?: number, enableHighAccuracy?: boolean}} options
 * @returns {Promise<LocationResult>} never rejects
 */
export const getCurrentLocation = (options = {}) => {
    const {
        timeout = 10000,
        maximumAge = 0,
        enableHighAccuracy = true,
    } = options;

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve({ ok: false, error: 'This device cannot share its location.' });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    ok: true,
                    coords: {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: position.timestamp,
                    },
                });
            },
            (error) => {
                resolve({ ok: false, error: describeGeoError(error) });
            },
            { enableHighAccuracy, timeout, maximumAge },
        );
    });
};

/**
 * Continuously track position. Useful while protection is active so an alert
 * has a recent fix ready instead of waiting on a cold GPS lock.
 *
 * @param {(result: LocationResult) => void} onUpdate
 * @returns {() => void} stop function
 */
export const watchLocation = (onUpdate) => {
    if (!navigator.geolocation) {
        onUpdate({ ok: false, error: 'This device cannot share its location.' });
        return () => { };
    }

    const id = navigator.geolocation.watchPosition(
        (position) => {
            onUpdate({
                ok: true,
                coords: {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp,
                },
            });
        },
        (error) => {
            onUpdate({ ok: false, error: describeGeoError(error) });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );

    return () => navigator.geolocation.clearWatch(id);
};

/**
 * @param {GeolocationPositionError} error
 * @returns {string}
 */
export const describeGeoError = (error) => {
    switch (error?.code) {
        case 1:
            return 'Location permission is turned off.';
        case 2:
            return 'Your location could not be determined right now.';
        case 3:
            return 'Finding your location took too long.';
        default:
            return 'Your location is unavailable.';
    }
};

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
export const getGoogleMapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

/**
 * Human-readable coordinates.
 * @param {{lat: number, lng: number}} coords
 * @returns {string}
 */
export const formatCoords = (coords) => {
    if (!coords) return 'Unknown';
    return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
};

/**
 * Beyond this radius a fix is too coarse to find someone with, and saying so
 * matters more than showing a number. A device without GPS commonly falls back
 * to IP-based lookup, which returns a plausible-looking city-centre pin with an
 * accuracy radius of tens or hundreds of kilometres.
 */
export const UNUSABLE_ACCURACY_M = 2000;

/**
 * Format a distance in units a person can read at a glance.
 * @param {number} meters
 * @returns {string}
 */
export const formatDistance = (meters) => {
    if (meters == null || !Number.isFinite(meters)) return '';
    if (meters < 1000) return `${Math.round(meters)} m`;
    const km = meters / 1000;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
};

/**
 * @param {number} accuracyMeters
 * @returns {boolean} whether the fix is precise enough to actually locate someone
 */
export const isAccuracyUsable = (accuracyMeters) =>
    accuracyMeters != null && Number.isFinite(accuracyMeters) && accuracyMeters <= UNUSABLE_ACCURACY_M;

/**
 * @param {number} accuracyMeters
 * @returns {string}
 */
export const describeAccuracy = (accuracyMeters) => {
    if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return '';
    if (accuracyMeters <= 50) return `Precise — within about ${formatDistance(accuracyMeters)}`;
    if (accuracyMeters <= 500) return `Good — within about ${formatDistance(accuracyMeters)}`;
    if (accuracyMeters <= UNUSABLE_ACCURACY_M) {
        return `Rough — within about ${formatDistance(accuracyMeters)}`;
    }
    return `Too rough to find you — could be anywhere within ${formatDistance(accuracyMeters)}`;
};

/**
 * Why a fix might be this poor, in terms the user can act on.
 * @param {number} accuracyMeters
 * @returns {string|null}
 */
export const explainPoorAccuracy = (accuracyMeters) => {
    if (isAccuracyUsable(accuracyMeters)) return null;
    return 'This device has no GPS, so your position was estimated from your internet connection. On a phone outdoors it is usually accurate to a few metres.';
};
