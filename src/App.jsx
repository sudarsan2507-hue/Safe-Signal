import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import WelcomeScreen from './components/WelcomeScreen';
import PermissionScreen from './components/PermissionScreen';
import ContactScreen from './components/ContactScreen';
import Dashboard from './components/Dashboard';
import EmergencyScreen from './components/EmergencyScreen';
import { loadContacts } from './utils/storage';

/**
 * Send people who have already set up straight to the dashboard.
 *
 * Previously "/" always rendered the welcome screen, so every visit meant
 * Welcome → Permissions → Contacts → Dashboard: three taps and four page loads
 * before the alert button was reachable, even though the contacts were already
 * saved. Onboarding should happen once, not on the way to an emergency.
 *
 * Having a contact is the signal that setup happened — an alert has nowhere to
 * go without one.
 */
const Entry = () => {
    const isSetUp = loadContacts().length > 0;
    return isSetUp ? <Navigate to="/dashboard" replace /> : <WelcomeScreen />;
};

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Entry />} />

                {/* Reachable deliberately, for anyone who wants the intro again. */}
                <Route path="/welcome" element={<WelcomeScreen />} />

                <Route path="/permissions" element={<PermissionScreen />} />
                <Route path="/contacts" element={<ContactScreen />} />
                <Route path="/dashboard" element={<Dashboard />} />

                {/* Deep link: opens directly into the alert countdown, with no
                    navigation at all. Used by the home-screen shortcut. */}
                <Route path="/sos" element={<Dashboard autoAlert />} />

                <Route path="/emergency" element={<EmergencyScreen />} />

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Router>
    );
}

export default App;
