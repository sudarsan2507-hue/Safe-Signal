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
 * @param {number} accuracyMeters
 * @returns {string}
 */
export const describeAccuracy = (accuracyMeters) => {
    if (accuracyMeters == null) return '';
    if (accuracyMeters <= 20) return 'Precise to about 20 m';
    if (accuracyMeters <= 100) return `Precise to about ${Math.round(accuracyMeters)} m`;
    return `Approximate — within about ${Math.round(accuracyMeters)} m`;
};
