# 🚨 SafeSignal - Silent Emergency AI Detection

> Protection when you cannot speak.

[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7-purple)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

**SafeSignal** is a mobile-first web application that uses AI to detect silent distress signals and automatically notify emergency contacts. Built as a hackathon MVP demonstrating multi-sensor fusion for emergency detection.

## ✨ Features

### 🛡️ Core Capabilities
- **Silent Monitoring**: Background detection without obvious emergency buttons
- **Multi-Sensor Fusion**: Combines gesture, voice stress, and motion analysis
- **Real-Time Risk Engine**: Weighted scoring algorithm with threshold-based triggering
- **False Positive Prevention**: 5-second confirmation window before alert
- **Instant Response**: Automatic location sharing and contact notification

### 🎨 User Experience
- **Modern UI**: Glassmorphism, gradients, and smooth animations
- **Mobile-First**: Responsive design optimized for touch devices
- **Visual Feedback**: Color-coded risk levels (🟢 Safe → 🟡 Moderate → 🔴 Danger)
- **Privacy-Focused**: Encrypted data, emergency-only sharing

## 🛠️ Tech Stack

- **Frontend**: React 18 + Vite 7
- **Routing**: React Router DOM v6
- **Animations**: Framer Motion
- **Styling**: Vanilla CSS with CSS Variables
- **APIs**: MediaDevices API, Geolocation API
- **Storage**: LocalStorage (MVP)

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Modern browser (Chrome, Edge, Firefox)

### Installation

```bash
# Clone the repository
git clone https://github.com/sudarsan2507-hue/Safe-Signal.git

# Navigate to project directory
cd Safe-Signal

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will open at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

## 🎬 Demo Flow

1. **Welcome Screen** → Click "Get Started"
2. **Permissions** → Enable Camera, Mic, Location
3. **Add Contacts** → Enter emergency contact details
4. **Dashboard** → Toggle "Protection ON"
5. **Risk Detection** → Watch real-time risk meter
6. **Pre-Alert** → 5-second cancellation window appears
7. **Emergency** → Alert sent with location to contacts

## 🧠 How It Works

### Risk Engine Algorithm

```javascript
Risk = (Gesture × 0.5) + (Stress × 0.3) + (Motion × 0.2)

Levels:
- Safe: Risk < 0.3 (🟢)
- Moderate: 0.3 ≤ Risk < 0.75 (🟡)
- Danger: Risk ≥ 0.75 (🔴)
```

### Detection Process

1. **Continuous Monitoring**: Sensors run in 1-second intervals
2. **Threshold Triggering**: High risk (>0.75) sustained for 5+ seconds
3. **Cancellation Window**: User has 5 seconds to cancel
4. **Emergency Protocol**: Location capture + contact notification

## 📁 Project Structure

```
Safe-Signal/
├── src/
│   ├── components/
│   │   ├── WelcomeScreen.jsx      # Landing page
│   │   ├── PermissionScreen.jsx   # Permission management
│   │   ├── ContactScreen.jsx      # Emergency contacts
│   │   ├── Dashboard.jsx          # Monitoring UI
│   │   └── EmergencyScreen.jsx    # Alert confirmation
│   ├── utils/
│   │   ├── riskEngine.js          # Detection logic
│   │   └── geo.js                 # Location helpers
│   └── index.css                  # Global styles
├── package.json
└── vite.config.js
```

## 🎯 Use Cases

- **Personal Safety**: Walking alone at night
- **High-Risk Professions**: Delivery drivers, security personnel
- **Vulnerable Populations**: Elderly, individuals with disabilities
- **Travel Safety**: Solo travelers in unfamiliar areas

## 🔮 Future Enhancements

- [ ] Real ML models (MediaPipe for gestures)
- [ ] Voice stress analysis (pitch/tone detection)
- [ ] Backend API (Firebase/Twilio for SMS)
- [ ] User authentication & profiles
- [ ] Notification history & analytics
- [ ] Wearable device integration

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Authors

- **Sudarsan** - [GitHub](https://github.com/sudarsan2507-hue)

## 🙏 Acknowledgments

- React team for the amazing framework
- Framer Motion for smooth animations
- Open source community for inspiration

---

**Built with ❤️ for hackathon excellence**

*SafeSignal - Because every second counts in an emergency*
