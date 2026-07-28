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
