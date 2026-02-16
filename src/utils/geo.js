/**
 * Get current geolocation
 * @returns {Promise<{lat: number, lng: number}>}
 */
export const getCurrentLocation = () => {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                });
            },
            (error) => {
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0,
            }
        );
    });
};

/**
 * Generate Google Maps link from coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string} - Google Maps URL
 */
export const getGoogleMapsLink = (lat, lng) => {
    return `https://www.google.com/maps?q=${lat},${lng}`;
};

/**
 * Mock location for demo (if permission denied)
 * @returns {{lat: number, lng: number}}
 */
export const getMockLocation = () => {
    return {
        lat: 40.7128, // New York City (example)
        lng: -74.006,
    };
};
