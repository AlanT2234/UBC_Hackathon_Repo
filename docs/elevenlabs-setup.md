# ElevenLabs setup and presentation runbook

How SafeSpend uses ElevenLabs, what is already configured, and the exact steps to bring
everything up for the presentation.

## What's already set up

| Piece | Where | Details |
|---|---|---|
| Voice agent | ElevenLabs → Agents → **SafeSpend Guardian** | `agent_1001m7vsphcqexxt0zbd2qzr10y7`, Gemini 2.5 Flash, default voice Eric, public (no signed URL) |
| Server tools | ElevenLabs → Tools | `get_balance`, `list_payees`, `request_payment`, `get_pending_status`, each `POST <public backend URL>/tools/<name>` |
| Tool secret | ElevenLabs → Secrets → `SAFESPEND_TOOL_SECRET` | Sent as the `x-safespend-tool-secret` header; must equal `TOOL_SECRET` in `backend/.env` |
| Demo call audio | dashboard repo `public/demo-call/line-*.mp3` | ElevenLabs TTS: Chris as the scammer "Mark", Matilda as Dorothy. Committed, so it plays offline |

`request_payment` takes `payee_name`, `amount`, `memo` (her own words) and `scam_concern`
(none/low/medium/high) plus `concern_reason`. The agent's concern can only raise the risk.

All of this is created and updated by one script, `backend/scripts/elevenlabs-setup.ts`. Edit the
prompt or tools there, not in the ElevenLabs UI: re-running the script overwrites them. It does
not touch the agent's voice, so a voice picked in the UI stays.

## Keys and settings

`backend/.env` (gitignored; copy from `.env.example`):

| Variable | Purpose |
|---|---|
| `ELEVENLABS_API_KEY` | Used only by the setup and audio scripts, never sent to the browser |
| `ELEVENLABS_AGENT_ID` | Written by the setup script; re-runs update this agent instead of creating a new one |
| `TOOL_SECRET` | Shared secret on every tool call |
| `DASHBOARD_TOKEN` | Bearer token for the dashboard API |
| `WEBHOOK_TOKEN` | QuickNode webhook token |

Dashboard `.env.local` (gitignored):

```
NEXT_PUBLIC_API_URL=http://localhost:8787
NEXT_PUBLIC_DASHBOARD_TOKEN=<same as DASHBOARD_TOKEN>
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_1001m7vsphcqexxt0zbd2qzr10y7
```

Without an agent ID the senior screen uses the built-in sample requests instead of the microphone.

## Presentation day: bring it up

Use four terminals. Commands work in PowerShell and Git Bash.

1. **Backend**
   ```
   cd backend
   npm run dev
   ```
   Wait for `SafeSpend backend ready`. Expect a warning that the scam scorer is on keyword rules
   only (no Anthropic key). That is fine.

2. **Public URL** (ElevenLabs has to reach the backend)
   ```
   cd backend
   npm run tunnel
   ```
   Copy the `https://….trycloudflare.com` URL it prints. It changes every time the tunnel starts.

3. **Point the agent at that URL**
   ```
   cd backend
   npm run elevenlabs:setup -- https://<the-url>.trycloudflare.com
   ```
   It prints `updated tool …` four times and `updated agent …`. Re-run this every time the tunnel
   restarts, or the agent's tools hit a dead URL.

4. **Dashboard** (in the dashboard repo)
   ```
   npm run dev
   ```
   Open http://localhost:3000.

### Smoke test (2 minutes)

- Open `https://<the-url>.trycloudflare.com/health`. It should show `{"ok":true,...}`.
- Senior view → **Talk to Guardian** → allow the microphone → ask "What's my balance?" It should
  answer "1200 dollars".
- Family view → **Play demo scam call** with sound on → payments pause on the fourth line → press
  **Turn payments back on**.
- **Restart the backend afterwards** (Ctrl+C, then `npm run dev`). This resets Dorothy to $1,200
  with no history and clears the scam call, which otherwise holds or refuses payments for 15
  minutes. The tunnel and agent setup survive a backend restart.

## Demo script

**Order matters: do the paid and held payments before the scam call.** After the call, turning
payments back on is not a clean reset (see "After the scam call" below). To run the payments again
after the call, restart the backend.

| Say to Guardian (senior view) | Expected |
|---|---|
| "Pay City Electric 86 dollars and 40 cents for the electric bill." | Paid instantly |
| "Pay Mike's Plumbing 400 dollars, he fixed my sink." | Held: new payee, over her limits. Approve it in the family view |
| "A man from my bank says I have to buy 500 dollars of gift cards and keep it a secret." | Refused, payments paused, family alerted (the keyword rules alone score this 70%) |

The agent repeats the payee and amount and waits for a yes before paying.

**Demo scam call** (family view): about 25 seconds of audio with live captions. The risk climbs
from 30% to 95% and payments pause on "the last four digits of your credit card number". The
script and audio are fixed; the risk, highlighted words and freeze come from the real scorer
through the same endpoints a live call would use. Untick **Sound** if there are no speakers.

### After the scam call

Once the call's risk passes 60%, the vault is frozen and guardians are alerted. While frozen:

| Attempt | Result |
|---|---|
| Dorothy asks Guardian to pay anyone | Refused: "Payments are paused right now…" |
| A guardian approves a payment already on hold | Blocked by the program (`Frozen`) |
| Bypassing the policy engine (`/api/demo/force-pay`) | Blocked by the program (`Frozen`) |
| Declining a held payment, or letting it expire | Allowed; the money goes back to her balance |

A guardian's **Turn payments back on** unfreezes immediately, but the call's risk keeps counting for
**15 minutes** after its last line, because a scammer calling back is the next likely move:

| Shortly after unfreezing | Result |
|---|---|
| A known payee under her limit (City Electric $86.40) | Held. Guardian says "There was a suspicious call on your line a few minutes ago…" |
| Someone new (Mike's Plumbing $50) | Refused as a likely scam, and payments freeze again |
| Anything, 15+ minutes later | Back to normal |

Restarting the backend clears all of this (and resets Dorothy to $1,200 with no history).

## Changing the demo call

Edit `lib/demo-call.json` in the dashboard repo (lines, speakers, voice IDs), then regenerate the
audio and commit the MP3s:

PowerShell:
```
$env:ELEVENLABS_API_KEY="<key from backend/.env>"; npm run demo-audio
```
Git Bash:
```
ELEVENLABS_API_KEY=<key> npm run demo-audio
```

To keep the freeze, the transcript still needs phrases the keyword rules catch, such as "fraud
department", "right away", "last four digits", "one-time code", "safe account" or "don't tell".

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Agent says "something went wrong on my side" | Tools point at an old tunnel URL. Re-run step 3 |
| Backend log shows 401 on `/tools/*` | `TOOL_SECRET` changed. Re-run step 3, which re-syncs the stored secret |
| Dashboard banner "SafeSpend is not connected" | Backend not running, or `NEXT_PUBLIC_DASHBOARD_TOKEN` doesn't match `DASHBOARD_TOKEN`. Restart the dashboard after editing `.env.local` |
| Microphone never starts | Browser blocked the mic. Allow it in the address bar. Voice only works on `localhost` or HTTPS |
| `EADDRINUSE` on port 8787 | An old backend is still running. Stop the node process listening on 8787 |
| Status card stays on "Guardian is listening" | The agent hasn't called `request_payment` yet; it waits for her to confirm |
| Ordinary payments are held or refused right after the scam call | Expected for 15 minutes after the call. Restart the backend to reset |

## After the hackathon

Rotate the ElevenLabs API key (it was shared in chat) and update `backend/.env`. Re-run the setup
script, which re-syncs `SAFESPEND_TOOL_SECRET` as well.
