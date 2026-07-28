import { describe, it, expect } from 'vitest';
import {
    formatDistance,
    isAccuracyUsable,
    describeAccuracy,
    explainPoorAccuracy,
    getGoogleMapsLink,
    formatCoords,
    UNUSABLE_ACCURACY_M,
} from '../geo.js';

describe('formatDistance', () => {
    it('uses metres below a kilometre', () => {
        expect(formatDistance(12)).toBe('12 m');
        expect(formatDistance(950)).toBe('950 m');
    });

    it('switches to kilometres above a kilometre', () => {
        expect(formatDistance(1500)).toBe('1.5 km');
        expect(formatDistance(500000)).toBe('500 km');
    });

    it('handles missing or invalid values', () => {
        expect(formatDistance(null)).toBe('');
        expect(formatDistance(NaN)).toBe('');
        expect(formatDistance(Infinity)).toBe('');
    });
});

describe('isAccuracyUsable', () => {
    it('accepts a precise fix', () => {
        expect(isAccuracyUsable(15)).toBe(true);
        expect(isAccuracyUsable(UNUSABLE_ACCURACY_M)).toBe(true);
    });

    it('rejects a fix too coarse to locate someone', () => {
        // 500 km is what IP-based lookup returns on a device without GPS.
        expect(isAccuracyUsable(500000)).toBe(false);
        expect(isAccuracyUsable(UNUSABLE_ACCURACY_M + 1)).toBe(false);
    });

    it('rejects missing accuracy', () => {
        expect(isAccuracyUsable(null)).toBe(false);
        expect(isAccuracyUsable(undefined)).toBe(false);
    });
});

describe('describeAccuracy', () => {
    it('describes each tier without raw metre counts in the millions', () => {
        expect(describeAccuracy(15)).toMatch(/precise/i);
        expect(describeAccuracy(300)).toMatch(/good/i);
        expect(describeAccuracy(1500)).toMatch(/rough/i);
        expect(describeAccuracy(500000)).toMatch(/too rough to find you/i);
        expect(describeAccuracy(500000)).toContain('500 km');
    });

    it('returns nothing when accuracy is unknown', () => {
        expect(describeAccuracy(null)).toBe('');
    });
});

describe('explainPoorAccuracy', () => {
    it('explains the cause only when the fix is poor', () => {
        expect(explainPoorAccuracy(15)).toBeNull();
        expect(explainPoorAccuracy(500000)).toMatch(/no GPS/i);
    });
});

describe('map helpers', () => {
    it('builds a maps link', () => {
        expect(getGoogleMapsLink(10.9894, 76.9598)).toBe(
            'https://www.google.com/maps?q=10.9894,76.9598',
        );
    });

    it('formats coordinates to five decimal places', () => {
        expect(formatCoords({ lat: 10.98940123, lng: 76.95980456 })).toBe('10.98940, 76.95980');
    });

    it('handles missing coordinates', () => {
        expect(formatCoords(null)).toBe('Unknown');
    });
});
