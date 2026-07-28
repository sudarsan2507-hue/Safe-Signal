# SafeSignal

> A quiet way to ask for help.

[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-purple)](https://vite.dev/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

SafeSignal is a mobile-first web app that watches for signs of distress — a deliberate hand
signal, tension in your voice, sudden violent movement — and prepares an alert for the people
you trust. Everything runs on your device.

## What it actually does

SafeSignal has **no server**. That shapes what it can and cannot promise, so it is worth being
precise:

| It does | It does not |
| --- | --- |
| Analyse camera, microphone and motion **entirely on-device** | Upload, record, or store any video or audio |
| Compose a real alert message with your location | Send that message by itself |
| Open your phone's SMS composer, share sheet, or clipboard | Confirm a contact received anything |
| Report exactly how far each contact got | Claim anyone "has been notified" |
| Give you 10 seconds to stop any alert | Contact emergency services |

**In a real emergency, call your local emergency number.** SafeSignal is a supplement, not a
replacement.

## Getting to help quickly

An emergency tool that takes four taps to reach is not an emergency tool.

- **Onboarding runs once.** If a contact is saved, `/` goes straight to the
  dashboard. Previously every visit walked Welcome → Permissions → Contacts →
  Dashboard even for a returning user.
- **`/sos` opens directly into the alert countdown.** No navigation, no taps.
- **Installable to a home screen.** One tap from the lock screen instead of
  finding a browser tab. Long-press the icon for shortcuts straight to
  "Get help now" or a check-in.
- **Opens without signal.** The service worker caches the app shell, so it
  starts even offline. Navigations are network-first, so you always get the
  newest build when you do have a connection.

There is no sign-up, no account and no password — there is no server to hold one.

**What installing does not buy you:** it is still a web app. It cannot run in the
background, cannot watch sensors while closed, cannot listen for a hardware
button, and cannot wake itself when a check-in expires — a missed deadline is
raised when you next open it. Those need a native app or a push backend.

## Check-in timer

The sensors cover *sudden* danger reasonably and *slow, silent* danger badly.
Someone who is genuinely threatened goes quiet and still — they don't scream,
and they don't hold a visible gesture up at a camera where an attacker can see
it. Voice stress needs you to be speaking; the hand signal needs you to act.

The check-in timer inverts that. You say when you expect to be safe, and if you
don't cancel by then, SafeSignal raises the alert **without you doing anything**.
The dangerous case requires no action, which is the only thing that works when
acting is exactly what you cannot do.

- Set a duration (15 min – 2 hours) and optionally a note like "Walking home
  from the station", which is included in the alert
- A 60-second grace period after expiry, because forgetting is far more likely
  than danger and a lapse should not wake your contacts
- Works with the screen off and the app closed — state is derived from stored
  timestamps, not a running timer, so a deadline missed while the browser was
  shut is honoured the moment you reopen it
- Independent of the protection toggle and of every sensor permission

## How detection works

### Sensor fusion

Three signals are combined into a single 0–1 risk score:

| Sensor | Base weight | Source |
| --- | --- | --- |
| Hand signal | 0.5 | MediaPipe hand landmarks — a closed fist held 2 seconds |
| Voice tension | 0.3 | MFCC, pitch, spectral centroid, ZCR via Meyda |
| Movement | 0.2 | DeviceMotion accelerometer |

Weights are **renormalised across the sensors actually running**. This matters: with fixed
weights, a laptop with only a camera would cap out at 0.5 and a phone with only a microphone at
0.3 — both permanently below the 0.75 threshold, so no alert could ever fire.

### Escalation rules

A high score alone is not enough. To escalate, **both** must hold:

1. Risk ≥ 0.75, continuously, for 5 seconds, and
2. Corroboration — either the hand signal is confirmed, or **two independent sensors** each read
   ≥ 0.6.

One noisy sensor can never summon help on its own. When those conditions are met you get a
10-second countdown with a large cancel button before anything is prepared.

### Voice scoring

The voice score is **rule-based, not a trained model** — there is no training
data and no network. Five features are combined:

| Feature | Weight | Direction |
| --- | --- | --- |
| Pitch above your baseline | 0.30 | Upward only |
| Spectral brightness above baseline | 0.28 | Upward only |
| Energy above your baseline | 0.22 | Upward only |
| Pitch variability | 0.12 | Absolute |
| Energy variability | 0.08 | Absolute |

Elevation features are **directional**: speaking more softly or lower than usual
does not count as distress, only rising above your own normal does.

Thresholds were calibrated against synthetic calm and distressed speech:

| Voice | Score |
| --- | --- |
| Calm (matches baseline) | 0.03 |
| Calm but quieter / lower | 0.03 – 0.07 |
| Animated, not distressed | 0.26 |
| Distressed | 0.66 |
| Severely distressed | 0.90 |

**Caveat worth stating plainly:** that calibration used synthesised signals, not
recordings of real people. The ordering and separation are sound, but the exact
numbers should be re-checked against real speech before anyone relies on them.
Treat the voice score as a hint, not a measurement — which is why it can never
raise an alert on its own.

### Voice baseline

On start, SafeSignal spends five seconds learning how you normally sound, then scores *deviation
from your own baseline* rather than absolute pitch or loudness — so a naturally loud or
high-pitched voice is not penalised. If you are silent during that window (the common case),
calibration still closes on time and a baseline is adopted later, the first time you speak.

## Getting started

```bash
git clone https://github.com/sudarsan2507-hue/Safe-Signal.git
cd Safe-Signal
npm install
npm run dev
```

Open `http://localhost:5173`.

> Camera, microphone, and motion sensors require a secure context. `localhost` counts; deploying
> anywhere else needs HTTPS.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Run the test suite |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | ESLint |

## Project structure

```
src/
├── components/
│   ├── WelcomeScreen.jsx      What SafeSignal does, in plain language
│   ├── PermissionScreen.jsx   Real per-permission prompts, real granted state
│   ├── ContactScreen.jsx      Emergency contacts (validated, persisted)
│   ├── Dashboard.jsx          Monitoring, risk fusion, countdown
│   ├── GestureDetector.jsx    Camera preview + hand landmark overlay
│   ├── AudioVisualizer.jsx    Voice reading, diagnostics behind a toggle
│   └── EmergencyScreen.jsx    Alert delivery with honest per-contact status
├── hooks/
│   └── useWakeLock.js         Keeps the screen awake while protecting
└── utils/
    ├── riskEngine.js          Fusion, corroboration, sustain tracking
    ├── gesturePipeline.js     MediaPipe fist detection
    ├── motionPipeline.js      DeviceMotion accelerometer
    ├── alerts.js              Message composition and dispatch
    ├── geo.js                 Location (no mock fallback)
    ├── storage.js             Defensive localStorage access
    └── audio/
        ├── audioCapture.js    Microphone, sized for continuous coverage
        ├── audioProcessor.js  Ring buffer, VAD, power-of-two framing
        ├── featureExtractor.js MFCC, normalised-autocorrelation pitch
        ├── stressInference.js Deviation-based scoring
        └── audioPipeline.js   Orchestration and calibration
```

## Testing

69 tests cover the logic that is hard to verify by hand — sensor fusion and escalation, DSP
framing and pitch estimation, stress inference, alert composition, and storage resilience.

```bash
npm test
```

Several tests exist specifically to pin down past regressions: that framing stays a power of two
(Meyda throws otherwise, and the `try/catch` around extraction turns that into silent zeros),
that a camera-only device can still reach the threshold, that escalation re-arms after being
cancelled, and that no status string ever claims a message was delivered.

## Design notes

The interface is deliberately calm. It is read by someone who may already be frightened, so:

- Soft contrast and generous spacing; red is reserved for the one moment it means something
- Every state is carried by **words and shape**, never colour alone
- Touch targets are at least 48 px; the cancel button is the largest thing on screen
- Light and dark themes, and `prefers-reduced-motion` is respected
- Technical readouts (MFCC heatmaps, weight tables) live behind a "technical details" toggle

## Privacy

- No account, no server, no analytics
- Camera and microphone frames are analysed in memory and discarded
- Contacts and the last alert are stored in `localStorage` on your device only
- Location is read only while protection is on, and only included in a message you choose to send

There is **no encryption**, because there is nothing in transit to encrypt. If someone has access
to your unlocked device, they can read your contacts.

## Limitations

- Detection runs only while the page is open and visible; there is no background service worker
- Motion sensing needs a device with an accelerometer (most desktops have none)
- Voice stress scoring is rule-based, not a trained model, and its thresholds are calibrated
  against synthetic speech rather than recordings of real people
- MediaPipe model and WASM are fetched from a CDN, so first load needs a connection

## License

MIT — see [LICENSE](LICENSE).

## Author

**Sudarsan** — [GitHub](https://github.com/sudarsan2507-hue)
