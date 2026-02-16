import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { getGoogleMapsLink } from '../utils/geo';
import './EmergencyScreen.css';

const EmergencyScreen = () => {
    const navigate = useNavigate();
    const [emergencyData, setEmergencyData] = useState(null);

    useEffect(() => {
        // Load emergency data from localStorage
        const data = JSON.parse(localStorage.getItem('lastEmergency') || '{}');
        setEmergencyData(data);
    }, []);

    const handleDismiss = () => {
        navigate('/dashboard');
    };

    if (!emergencyData || !emergencyData.location) {
        return null;
    }

    const mapsLink = getGoogleMapsLink(
        emergencyData.location.lat,
        emergencyData.location.lng
    );

    return (
        <div className="page emergency-screen">
            <motion.div
                className="emergency-container"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
            >
                {/* Alert Icon */}
                <motion.div
                    className="alert-icon"
                    animate={{
                        scale: [1, 1.1, 1],
                        rotate: [0, 5, -5, 0],
                    }}
                    transition={{
                        repeat: Infinity,
                        duration: 1.5,
                    }}
                >
                    🚨
                </motion.div>

                {/* Title */}
                <h1 className="emergency-title">Emergency Alert Sent</h1>

                {/* Message */}
                <p className="emergency-message">
                    Your emergency contacts have been notified with your location and details.
                </p>

                {/* Info Cards */}
                <div className="info-cards">
                    {/* Contacts Notified */}
                    <div className="info-card">
                        <span className="info-icon">📞</span>
                        <div>
                            <h3>Contacts Notified</h3>
                            <p>{emergencyData.contacts?.length || 0} people</p>
                        </div>
                    </div>

                    {/* Location */}
                    <div className="info-card">
                        <span className="info-icon">📍</span>
                        <div>
                            <h3>Location Shared</h3>
                            <a
                                href={mapsLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="maps-link"
                            >
                                View on Google Maps
                            </a>
                        </div>
                    </div>

                    {/* Time */}
                    <div className="info-card">
                        <span className="info-icon">🕐</span>
                        <div>
                            <h3>Time Triggered</h3>
                            <p>{new Date(emergencyData.timestamp).toLocaleTimeString()}</p>
                        </div>
                    </div>
                </div>

                {/* Stay Calm Message */}
                <div className="calm-message">
                    <p>🛡️ Stay Calm. Help is Notified.</p>
                    <p className="sub-message">Keep this screen open for emergency responders.</p>
                </div>

                {/* Dismiss Button */}
                <button className="btn-secondary dismiss-btn" onClick={handleDismiss}>
                    Return to Dashboard
                </button>
            </motion.div>
        </div>
    );
};

export default EmergencyScreen;
