# Turning the backend on

The app works without any of this. The check-in timer runs on your device and
prepares a message you send yourself.

What this adds is the one thing a browser cannot do: **dispatching the alert
with no help from your phone**, so it still goes out when you are unable to act.
That is the gap the rest of the app cannot close — a web page has no way to send
an SMS or place a call unattended, and if you have been taken, you are not there
to press send.

Nothing here is wired up yet. Everything below is code that exists and is
waiting for credentials.

---

## What you are building

```
  phone                    Vercel                     Upstash            provider
    │                        │                           │                   │
    ├─ start check-in ──────▶│                           │                   │
    │                        ├─ store record ───────────▶│                   │
    │                        ├─ schedule callback ──────▶│                   │
    │                                                    │                   │
    │   ── time passes, phone may be off or taken ──                         │
    │                                                    │                   │
    │                        │◀─ callback at deadline ───┤                   │
    │                        ├─ still active? ───────────▶│                  │
    │                        ├─ call + text contacts ───────────────────────▶│
```

If you tap **I'm safe** first, the record is deleted and the callback finds
nothing to act on.

---

## Step 1 — Upstash (free tier is enough)

At [upstash.com](https://upstash.com):

1. **Redis** → create a database → copy `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` from the REST API section.
2. **QStash** → copy the token into `QSTASH_TOKEN`.

QStash schedules a *single* callback for the exact moment a check-in expires.
That is deliberately not cron: a five-minute timer does not want a job polling
every minute, and Vercel's Hobby plan limits cron frequency too severely for
that to work anyway.

## Step 2 — a signing secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put it in `CHECKIN_SIGNING_SECRET`. This signs the token that proves a cancel
request is really yours. Without it, anyone guessing a check-in id could switch
off your safety timer and leave you believing you were covered. Changing it
later invalidates every check-in in flight.

## Step 3 — pick who places the call

Set `MESSAGING_PROVIDER` to one of:

| Value | Use when |
| --- | --- |
| `console` | Local testing. Logs what it *would* send. **The default.** |
| `twilio` | International numbers |
| `exotel` | Indian numbers |

### For Indian numbers, prefer Exotel

This is the part most likely to stall you, and it is paperwork rather than code.
Twilio can reach Indian numbers, but automated voice calls need a regulatory
bundle with a verified address, and India's DND registry restricts them.
Exotel is a domestic operator and handles TRAI/DLT registration as part of
onboarding.

One structural difference: Exotel does not read text aloud from the API the way
Twilio's TwiML does. You build a flow (an "applet") in their dashboard that
speaks the message, and put its URL in `EXOTEL_FLOW_URL`. The **text message**
still carries the full detail including the location, which is why the alert
never depends on the call alone.

## Step 4 — environment variables

Copy `.env.example` to `.env.local` for local work. For production, add the same
keys in **Vercel → Project → Settings → Environment Variables**.

Then set `VITE_BACKEND_ENABLED=true` so the client actually calls the API. Until
that is set, the app uses only its on-device timer and says so.

## Step 5 — check it

```bash
curl -X POST https://<your-app>/api/checkin/start \
  -H 'Content-Type: application/json' \
  -d '{"durationMs":60000,"contacts":[{"name":"Test","phone":"+919876543210"}]}'
```

A missing configuration answers `503` and **names the variables it needs** —
that is deliberate, so a half-set-up deployment is diagnosable from the response
rather than from a stack trace.

With `MESSAGING_PROVIDER=console` you can watch the whole flow in the Vercel
function logs without ringing anybody.

---

## Design decisions worth knowing

**No dependencies.** Every adapter talks to a REST API over `fetch`. There is
nothing to `npm install`, and no SDK to keep patched.

**A half-configured provider falls back to logging.** If `MESSAGING_PROVIDER` is
`twilio` but a credential is blank, the request is logged rather than sent, and
the response carries a warning naming the missing variable. Degrading to
"logged, not sent" is survivable; crashing and losing the alert is not.

**Firing is claimed exactly once.** Schedulers retry, and a network hiccup after
the calls were placed looks exactly like a failure. A claim key makes sure one
missed check-in cannot ring a contact repeatedly — and the claim is *released*
if dispatch fails, so a transient outage does not permanently prevent the alert.

**Cancel deletes the record first.** The fire endpoint refuses to act on a
record that is gone, so if withdrawing the scheduled callback fails, the cost is
a wasted callback rather than a false alarm.

**The client never assumes it worked.** If registration fails, the on-device
timer still runs and the card says plainly that you will need to send the alert
yourself. Believing you are covered when you are not is the worst failure this
feature could have.

---

## The privacy cost

Be clear-eyed about this. Today the app stores nothing off-device, and every
screen says so truthfully. Turning the backend on means your contacts' phone
numbers, your location, and your check-in schedule are held on a server.

That is a real trade, not a technicality. I think it is worth making — *"we
never uploaded your data"* is cold comfort if nobody was told you were in
trouble — but the copy in the app should be updated to match once it is on, or
the app starts making a promise it no longer keeps.
