import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import './PermissionScreen.css';

const PermissionScreen = () => {
    const navigate = useNavigate();
    const [permissions, setPermissions] = useState({
        camera: false,
        microphone: false,
        location: false,
    });

    const [requesting, setRequesting] = useState(false);

    const togglePermission = (type) => {
        setPermissions((prev) => ({
            ...prev,
            [type]: !prev[type],
        }));
    };

    const requestPermissions = async () => {
        setRequesting(true);

        try {
            // Request Camera & Microphone
            if (permissions.camera || permissions.microphone) {
                const constraints = {
                    video: permissions.camera,
                    audio: permissions.microphone,
                };
                await navigator.mediaDevices.getUserMedia(constraints);
            }

            // Request Location
            if (permissions.location) {
                await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject);
                });
            }

            // Navigate to contacts screen
            setTimeout(() => {
                navigate('/contacts');
            }, 500);
        } catch (error) {
            console.error('Permission denied:', error);
            alert('Please allow permissions to continue. These are essential for your safety.');
            setRequesting(false);
        }
    };

    const allEnabled = permissions.camera && permissions.microphone && permissions.location;

    return (
        <div className="page permission-screen">
            <motion.div
                className="permission-container"
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
                    <h2>Enable Permissions</h2>
                    <p className="subtitle">
                        SafeSignal needs these permissions to protect you effectively
                    </p>
                </motion.div>

                {/* Permission Toggles */}
                <motion.div
                    className="permissions-list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                >
                    {/* Camera */}
                    <div className="permission-item">
                        <div className="permission-info">
                            <span className="permission-icon">📷</span>
                            <div>
                                <h3>Camera Access</h3>
                                <p>Detect distress gestures</p>
                            </div>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={permissions.camera}
                                onChange={() => togglePermission('camera')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    {/* Microphone */}
                    <div className="permission-item">
                        <div className="permission-info">
                            <span className="permission-icon">🎤</span>
                            <div>
                                <h3>Microphone Access</h3>
                                <p>Analyze voice stress patterns</p>
                            </div>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={permissions.microphone}
                                onChange={() => togglePermission('microphone')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    {/* Location */}
                    <div className="permission-item">
                        <div className="permission-info">
                            <span className="permission-icon">📍</span>
                            <div>
                                <h3>Location Access</h3>
                                <p>Share your location in emergencies</p>
                            </div>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={permissions.location}
                                onChange={() => togglePermission('location')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                </motion.div>

                {/* CTA Button */}
                <motion.button
                    className={`btn-primary cta-button ${!allEnabled ? 'disabled' : ''}`}
                    onClick={requestPermissions}
                    disabled={!allEnabled || requesting}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    whileHover={allEnabled ? { scale: 1.05 } : {}}
                    whileTap={allEnabled ? { scale: 0.95 } : {}}
                >
                    {requesting ? 'Requesting...' : 'Enable & Continue'}
                </motion.button>

                {/* Info Text */}
                <motion.p
                    className="info-text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                >
                    🔒 Your privacy is protected. Data is encrypted and only shared during emergencies.
                </motion.p>
            </motion.div>
        </div>
    );
};

export default PermissionScreen;
