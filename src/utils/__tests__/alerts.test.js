import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    buildAlertMessage,
    createAlert,
    markRecipientStatus,
    buildSmsLink,
    describeStatus,
    summariseAlert,
} from '../alerts.js';
import { loadContacts, saveContacts, loadLastAlert } from '../storage.js';

beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
});

const contacts = [
    { id: 'a', name: 'Priya', phone: '+91 98765 43210' },
    { id: 'b', name: 'Sam', phone: '07700 900123' },
];

describe('buildAlertMessage', () => {
    it('includes a maps link when the location is known', () => {
        const message = buildAlertMessage({
            location: { lat: 12.9716, lng: 77.5946, accuracy: 15 },
            locationError: null,
            reason: 'Held the hand signal',
        });
        expect(message).toContain('google.com/maps?q=12.9716,77.5946');
        expect(message).toContain('Held the hand signal');
    });

    it('says location is unavailable rather than inventing coordinates', () => {
        // The old code silently substituted a hardcoded New York position,
        // which would send help to the wrong place.
        const message = buildAlertMessage({
            location: null,
            locationError: 'Location permission is turned off.',
            reason: null,
        });
        expect(message).toContain('unavailable');
        expect(message).toContain('Location permission is turned off.');
        expect(message).not.toMatch(/40\.7128|-74\.006/);
    });
});

describe('createAlert', () => {
    it('starts every recipient as ready, never as sent', () => {
        const alert = createAlert({ contacts, location: null, locationError: 'x', reason: null });
        expect(alert.recipients).toHaveLength(2);
        for (const recipient of alert.recipients) {
            expect(recipient.status).toBe('ready');
        }
    });

    it('persists the alert for the emergency screen', () => {
        createAlert({ contacts, location: null, locationError: null, reason: 'Manual alert' });
        expect(loadLastAlert().reason).toBe('Manual alert');
    });

    it('handles having no contacts', () => {
        const alert = createAlert({ contacts: [], location: null, locationError: null, reason: null });
        expect(alert.recipients).toEqual([]);
    });
});

describe('markRecipientStatus', () => {
    it('updates one recipient without touching the others', () => {
        const alert = createAlert({ contacts, location: null, locationError: null, reason: null });
        const updated = markRecipientStatus(alert, 'a', 'opened');
        expect(updated.recipients.find((r) => r.id === 'a').status).toBe('opened');
        expect(updated.recipients.find((r) => r.id === 'b').status).toBe('ready');
    });
});

describe('buildSmsLink', () => {
    it('strips formatting from the number', () => {
        const link = buildSmsLink('+91 (987) 654-3210', 'help');
        expect(link.startsWith('sms:+919876543210')).toBe(true);
    });

    it('encodes the message body', () => {
        const link = buildSmsLink('123', 'a b&c');
        expect(link).toContain('a%20b%26c');
    });

    it('uses the Apple separator on Apple devices', () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
        expect(buildSmsLink('123', 'x')).toContain('sms:123&body=');
    });

    it('uses the standard separator elsewhere', () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14)' });
        expect(buildSmsLink('123', 'x')).toContain('sms:123?body=');
    });
});

describe('describeStatus', () => {
    it('never claims a message was delivered', () => {
        for (const status of ['ready', 'opened', 'shared', 'copied', 'failed']) {
            const text = describeStatus(status).toLowerCase();
            expect(text).not.toContain('delivered');
            expect(text).not.toContain('notified');
            expect(text).not.toContain('received');
        }
    });

    it('asks the user to confirm after opening the composer', () => {
        expect(describeStatus('opened')).toMatch(/check/i);
    });
});

describe('summariseAlert', () => {
    it('states plainly that nothing has been sent yet', () => {
        const alert = createAlert({ contacts, location: null, locationError: null, reason: null });
        const summary = summariseAlert(alert);
        expect(summary.detail).toMatch(/nothing has been sent/i);
        expect(summary.allHandled).toBe(false);
    });

    it('reports partial progress', () => {
        let alert = createAlert({ contacts, location: null, locationError: null, reason: null });
        alert = markRecipientStatus(alert, 'a', 'opened');
        expect(summariseAlert(alert).headline).toBe('1 of 2 contacts opened');
    });

    it('asks for confirmation once all are handled', () => {
        let alert = createAlert({ contacts, location: null, locationError: null, reason: null });
        alert = markRecipientStatus(alert, 'a', 'opened');
        alert = markRecipientStatus(alert, 'b', 'opened');
        const summary = summariseAlert(alert);
        expect(summary.allHandled).toBe(true);
        expect(summary.detail).toMatch(/confirm/i);
    });

    it('prompts when there are no contacts', () => {
        const alert = createAlert({ contacts: [], location: null, locationError: null, reason: null });
        expect(summariseAlert(alert).headline).toBe('No contacts saved');
    });
});

describe('contact storage', () => {
    it('round-trips contacts', () => {
        saveContacts(contacts);
        expect(loadContacts()).toHaveLength(2);
    });

    it('returns an empty list when nothing is stored', () => {
        expect(loadContacts()).toEqual([]);
    });

    it('discards malformed entries instead of throwing', () => {
        window.localStorage.setItem(
            'safesignal.contacts',
            JSON.stringify([{ name: 'Ok', phone: '123' }, null, { name: '', phone: '' }, 'nonsense']),
        );
        expect(loadContacts()).toHaveLength(1);
    });

    it('survives corrupt JSON', () => {
        window.localStorage.setItem('safesignal.contacts', '{not json');
        expect(loadContacts()).toEqual([]);
    });

    it('migrates contacts saved under the old key', () => {
        window.localStorage.setItem(
            'emergencyContacts',
            JSON.stringify([{ id: 1, name: 'Old', phone: '555' }]),
        );
        const loaded = loadContacts();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].name).toBe('Old');
        expect(window.localStorage.getItem('emergencyContacts')).toBeNull();
    });
});
