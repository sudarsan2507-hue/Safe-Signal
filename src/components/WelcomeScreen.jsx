import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import './WelcomeScreen.css';

const WelcomeScreen = () => {
  const navigate = useNavigate();

  return (
    <div className="page welcome-screen">
      <motion.div
        className="welcome-container"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        {/* Logo */}
        <motion.div
          className="logo-container"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        >
          <div className="logo-circle">
            <svg
              width="80"
              height="80"
              viewBox="0 0 80 80"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="40" cy="40" r="38" stroke="url(#gradient)" strokeWidth="4" />
              <path
                d="M40 20 L40 35 M40 45 L40 60 M25 40 L60 40"
                stroke="url(#gradient)"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="80" y2="80">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </motion.div>

        {/* Title */}
        <motion.h1
          className="title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          SafeSignal
        </motion.h1>

        {/* Tagline */}
        <motion.div
          className="tagline-container"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <p className="tagline">Protection when you cannot speak.</p>
          <p className="subtitle">
            Silent, intelligent emergency response powered by AI
          </p>
        </motion.div>

        {/* Features Preview */}
        <motion.div
          className="features-preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <div className="feature-item">
            <span className="feature-icon">👁️</span>
            <span className="feature-text">Gesture Detection</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🎤</span>
            <span className="feature-text">Voice Analysis</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">📍</span>
            <span className="feature-text">Location Sharing</span>
          </div>
        </motion.div>

        {/* CTA Button */}
        <motion.button
          className="btn-primary cta-button"
          onClick={() => navigate('/permissions')}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Get Started
        </motion.button>

        {/* Footer Text */}
        <motion.p
          className="footer-text"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          Your safety, our priority
        </motion.p>
      </motion.div>
    </div>
  );
};

export default WelcomeScreen;
