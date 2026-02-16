import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import WelcomeScreen from './components/WelcomeScreen';
import PermissionScreen from './components/PermissionScreen';
import ContactScreen from './components/ContactScreen';
import Dashboard from './components/Dashboard';
import EmergencyScreen from './components/EmergencyScreen';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WelcomeScreen />} />
        <Route path="/permissions" element={<PermissionScreen />} />
        <Route path="/contacts" element={<ContactScreen />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/emergency" element={<EmergencyScreen />} />
      </Routes>
    </Router>
  );
}

export default App;
