import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import './ContactScreen.css';

const ContactScreen = () => {
    const navigate = useNavigate();
    const [contacts, setContacts] = useState([]);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');

    const addContact = () => {
        if (name.trim() && phone.trim()) {
            const newContact = { id: Date.now(), name, phone };
            const updatedContacts = [...contacts, newContact];
            setContacts(updatedContacts);

            // Save to localStorage
            localStorage.setItem('emergencyContacts', JSON.stringify(updatedContacts));

            // Clear form
            setName('');
            setPhone('');
        }
    };

    const removeContact = (id) => {
        const updatedContacts = contacts.filter((contact) => contact.id !== id);
        setContacts(updatedContacts);
        localStorage.setItem('emergencyContacts', JSON.stringify(updatedContacts));
    };

    const handleContinue = () => {
        if (contacts.length > 0) {
            navigate('/dashboard');
        } else {
            alert('Please add at least one emergency contact to continue.');
        }
    };

    return (
        <div className="page contact-screen">
            <motion.div
                className="contact-container"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
            >
                {/* Header */}
                <motion.div
                    className="header"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                >
                    <h2>Emergency Contacts</h2>
                    <p className="subtitle">
                        Add trusted people who will be notified in an emergency
                    </p>
                </motion.div>

                {/* Add Contact Form */}
                <motion.div
                    className="add-contact-form card"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                >
                    <input
                        type="text"
                        placeholder="Contact Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="input-field"
                    />
                    <input
                        type="tel"
                        placeholder="Phone Number"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="input-field"
                    />
                    <button className="btn-secondary add-btn" onClick={addContact}>
                        ➕ Add Contact
                    </button>
                </motion.div>

                {/* Contact List */}
                {contacts.length > 0 && (
                    <motion.div
                        className="contact-list"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6 }}
                    >
                        <h3>Saved Contacts ({contacts.length})</h3>
                        {contacts.map((contact, index) => (
                            <motion.div
                                key={contact.id}
                                className="contact-item card"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.1 * index }}
                            >
                                <div className="contact-info">
                                    <span className="contact-icon">👤</span>
                                    <div>
                                        <h4>{contact.name}</h4>
                                        <p>{contact.phone}</p>
                                    </div>
                                </div>
                                <button
                                    className="remove-btn"
                                    onClick={() => removeContact(contact.id)}
                                >
                                    ✕
                                </button>
                            </motion.div>
                        ))}
                    </motion.div>
                )}

                {/* CTA Button */}
                <motion.button
                    className={`btn-primary cta-button ${contacts.length === 0 ? 'disabled' : ''}`}
                    onClick={handleContinue}
                    disabled={contacts.length === 0}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    whileHover={contacts.length > 0 ? { scale: 1.05 } : {}}
                    whileTap={contacts.length > 0 ? { scale: 0.95 } : {}}
                >
                    Save & Activate Protection
                </motion.button>

                {/* Info Text */}
                <motion.p
                    className="info-text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1 }}
                >
                    💡 You can add or edit contacts later from settings
                </motion.p>
            </motion.div>
        </div>
    );
};

export default ContactScreen;
