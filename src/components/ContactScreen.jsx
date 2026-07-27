import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadContacts, saveContacts } from '../utils/storage';
import './ContactScreen.css';

/**
 * Emergency contacts.
 *
 * Contacts are loaded from storage on mount. Without that, the screen started
 * from an empty list and the first save overwrote every previously stored
 * contact — silently losing exactly the data the app depends on.
 */

/** Accepts international and local formats; rejects obvious nonsense. */
const PHONE_PATTERN = /^\+?[\d\s\-().]{6,20}$/;

const ContactScreen = () => {
    const navigate = useNavigate();

    // Read straight from storage during initialisation. Starting from an empty
    // list and filling it in later meant the first save overwrote every
    // previously stored contact.
    const [contacts, setContacts] = useState(loadContacts);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [saveFailed, setSaveFailed] = useState(false);

    /**
     * @param {Array} next
     */
    const persist = (next) => {
        setContacts(next);
        setSaveFailed(!saveContacts(next));
    };

    const addContact = (event) => {
        event.preventDefault();

        const trimmedName = name.trim();
        const trimmedPhone = phone.trim();

        if (!trimmedName) {
            setError('Please add a name so you know who this is.');
            return;
        }
        if (!PHONE_PATTERN.test(trimmedPhone)) {
            setError('That phone number does not look right. Include the country code if you can.');
            return;
        }
        if (contacts.some((c) => c.phone.replace(/\D/g, '') === trimmedPhone.replace(/\D/g, ''))) {
            setError('That number is already saved.');
            return;
        }

        setError('');
        persist([
            ...contacts,
            {
                id: crypto.randomUUID?.() ?? `c-${Date.now()}`,
                name: trimmedName,
                phone: trimmedPhone,
            },
        ]);
        setName('');
        setPhone('');
    };

    /**
     * @param {string} id
     */
    const removeContact = (id) => {
        persist(contacts.filter((contact) => contact.id !== id));
    };

    return (
        <div className="page contact-screen">
            <div className="screen-inner">
                <header className="screen-header">
                    <h1>Who should we reach?</h1>
                    <p className="screen-subtitle">
                        These are the people SafeSignal will prepare a message for. Choose someone
                        who would pick up.
                    </p>
                </header>

                <form className="contact-form" onSubmit={addContact} noValidate>
                    <div className="field">
                        <label htmlFor="contact-name">Name</label>
                        <input
                            id="contact-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Priya"
                            autoComplete="name"
                        />
                    </div>

                    <div className="field">
                        <label htmlFor="contact-phone">Phone number</label>
                        <input
                            id="contact-phone"
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+91 98765 43210"
                            autoComplete="tel"
                            aria-describedby={error ? 'contact-error' : undefined}
                            aria-invalid={Boolean(error)}
                        />
                    </div>

                    {error && (
                        <p className="field-error" id="contact-error" role="alert">
                            {error}
                        </p>
                    )}

                    <button type="submit" className="btn-secondary">
                        Add contact
                    </button>
                </form>

                {saveFailed && (
                    <p className="field-error" role="alert">
                        Your contacts could not be saved on this device. Private browsing usually
                        blocks storage — try a normal window.
                    </p>
                )}

                {contacts.length > 0 && (
                    <section className="contact-list" aria-label="Saved contacts">
                        <h2 className="section-title">
                            Saved {contacts.length === 1 ? 'contact' : 'contacts'} ({contacts.length})
                        </h2>
                        <ul>
                            {contacts.map((contact) => (
                                <li key={contact.id} className="contact-item">
                                    <div className="contact-details">
                                        <span className="contact-name">{contact.name}</span>
                                        <span className="contact-phone">{contact.phone}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="icon-button"
                                        onClick={() => removeContact(contact.id)}
                                        aria-label={`Remove ${contact.name}`}
                                    >
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <div className="screen-actions">
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => navigate('/dashboard')}
                        disabled={contacts.length === 0}
                    >
                        {contacts.length === 0 ? 'Add a contact to continue' : 'Continue'}
                    </button>
                </div>

                <p className="screen-note">
                    Contacts stay on this device. SafeSignal has no server and cannot upload them.
                </p>
            </div>
        </div>
    );
};

export default ContactScreen;
