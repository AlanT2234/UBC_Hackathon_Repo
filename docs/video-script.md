# SafeNSound demo video script

Submission requirement: a **2–3 minute** video, **with ElevenLabs audio**, on YouTube or Google
Drive and viewable by the judges. Target length: **≈2:55**. The narration is about 275 words (≈1:50 spoken); the
rest of the time is demo audio and pauses.

- **Narrator**: the voiceover.
- **Dorothy**: an ElevenLabs voice ("SafeNSound Dorothy (voice 3)", made with Voice Design). Play the named
  MP3 from `media/dorothy/` (dashboard repo) near the laptop's microphone so the voice agent hears
  it. Regenerate them with `npm run dorothy-lines`.
- *(Agent: …)*: what SafeNSound says back. Its wording varies a little between takes.

Setup, recording tips and troubleshooting are in [elevenlabs-setup.md](elevenlabs-setup.md).

---

## Scene 1: Hook (0:00–0:15)

**On screen:** SafeNSound logo, then fade to Dorothy's senior view showing $1,200.

**Narrator:**
> Older Americans lose billions of dollars a year to scams, often in a single phone call. This is SafeNSound. Dorothy pays her bills just by talking, and the rules that protect her money can't be talked out of.

## Scene 2: Paid (0:15–0:38)

**On screen:** Dorothy taps **Talk to SafeNSound**.

*(Agent: "Hello Dorothy, it's SafeNSound. Who would you like to pay today?")*

**Dorothy** ▶ `01-city-electric.mp3`:
> Pay City Electric eighty-six dollars and forty cents for the electric bill.

*(The agent repeats the payee and amount.)*

**Dorothy** ▶ `02-yes-please.mp3`:
> Yes, please.

*(The card shows **Paid** and the balance drops.)*

**Narrator** (over the Paid card):
> City Electric is a payee her family already approved, and the amount is within her limits, so it goes through right away.

## Scene 3: Held, then approved (0:38–1:08)

**Dorothy** ▶ `03-mikes-plumbing.mp3`:
> Pay Mike's Plumbing four hundred dollars. He fixed my sink.

*(The agent repeats it; play `04-yes.mp3`. Agent: "I don't know Mike's Plumbing yet, so I've put 400 dollars on hold and asked Sam…")*

**Narrator** (as the card shows **Waiting for family**):
> Mike is new, and four hundred dollars is over her limit. So the money moves into escrow, and her grandson Sam is asked to approve.

**On screen:** cut to the Guardian view. The held payment, then Sam clicks **Approve as Sam**, then **Paid**.

**Narrator:**
> Sam checks with her and approves. Otherwise, the money would simply go back to her.

## Scene 4: A trusted name, a scam request (1:08–1:28)

**On screen:** back to Dorothy's view. She taps **Talk to SafeNSound**.

**Dorothy** ▶ `05-maria-gift-cards.mp3`:
> Pay Maria fifty dollars. She asked me to buy her some gift cards.

*(The agent repeats it; play `04-yes.mp3`. Agent: "Something about this sounds like a scam warning sign, so I've put 50 dollars on hold and asked Sam…")*

**Narrator** (as the card shows **Waiting for family**):
> Maria is her cleaner, already on her list. But scammers pose as people we know, and gift cards are their favorite trick. So even a trusted name waits for family when the request sounds like a scam.

## Scene 5: The scam call (1:28–2:05)

**On screen:** Guardian view. Click **Play demo scam call** with sound on.

**On-screen caption** (keep it up for the whole scene): *Recorded scam call, replayed through SafeNSound's call-scoring pipeline.*

**Narrator** (one line before the audio starts):
> SafeNSound is built to listen to calls from unknown numbers. Here's a recorded scam call.

*(Let the call play: the "fraud department", "act right away", "last four digits of your credit card". The freeze lands on line 4. Let a line or two more play, then lower the volume.)*

**Narrator** (once the **Payments paused** badge is showing):
> A fake bank, pressure to act fast, and a request for her card number. SafeNSound recognises the scam and freezes her payments before she can act.

**On screen:** cut to Dorothy's view. She taps **Talk to SafeNSound**.

**Dorothy** ▶ `06-pay-the-bank.mp3`:
> Pay the bank five hundred dollars.

*(Agent: "Payments are paused right now while your guardians check on something. Your money is safe.")*

## Scene 6: Onchain proof (2:05–2:32)

**On screen:** terminal running `npm run devnet -- run --step` (from `backend/`), then Solana Explorer showing the rejected transactions.

**Narrator:**
> The voice assistant never decides. The rules live in a Solana program. Here, the assistant's own key tries to send nine hundred dollars, and the program rejects it. A payment to someone not on her list: rejected. And once the vault is frozen, even twenty dollars is refused. No voice, script or jailbroken AI can override the program.

## Scene 7: Guardian tools (2:32–2:45)

**On screen:** a quick pan through Payment history (filters, Download CSV), Payees (the 24-hour badge) and Rules.

**Narrator:**
> Her family sees every payment and why, approves new payees after a twenty-four-hour wait, and can pause everything with one tap.

## Scene 8: Close (2:45–2:55)

**On screen:** SafeNSound logo, with a small credit line: *Dorothy's voice and the scam call: ElevenLabs Voice Design and text-to-speech.*

**Narrator:**
> SafeNSound: voice payments that keep seniors safe and sound. Built with ElevenLabs Agents, Voice Design and text-to-speech, and Solana.

---

## Notes before recording

- **Playing Dorothy's lines.** Start each MP3 only after SafeNSound has finished speaking; the agent
  waits for her to finish and then answers. Keep the speaker close to the mic and the room quiet.
  If the agent's reply gets cut off by your playback, wait a beat longer. All seven clips were
  checked with ElevenLabs speech-to-text and transcribe word for word. `07-whats-my-balance.mp3` is
  for the pre-recording smoke test.
- **Same Dorothy everywhere.** The scam call's Dorothy lines use the same "SafeNSound Dorothy (voice 3)" voice
  (`npm run demo-audio`), so she sounds like one person across the video.

- **Don't imply live phone listening.** The Twilio call bridge isn't built, which is why Scene 5
  says "built to listen" and "recorded scam call", and why the caption stays on screen. Keep it
  that way, so a judge can't fairly say the video overclaims.
- **Scene 4 can end two ways.** The keyword rules alone hold this request, but the voice agent also
  gives its own scam judgement. If it rates the request a clear scam, SafeNSound **refuses** it and
  **pauses payments** instead ("This sounds like a common scam, so I'm not sending it…"). Both are
  correct. If you get the refusal, either keep it and change the last narration sentence to "So
  even a trusted name is refused when the request sounds like a scam", or retake. Either way, press
  **Turn payments back on** in the Guardian view before Scene 5, so the freeze in the scam call is
  the moment payments pause.
- **Order matters within a take:** Scenes 2–4 before the scam call. After Scene 5, payments stay
  held for 15 minutes, so restart the backend before each full take.
- **Scene 5's payment line is deliberately plain** ("Pay the bank five hundred dollars"), because
  payments are already paused. Any request shows the freeze.
- **ElevenLabs credit:** the closing line and on-screen credit name the products used: Agents for
  the assistant, and Voice Design plus text-to-speech for Dorothy and the scam call's voices. That helps with the bounty's "shows the integration"
  criterion.
- **Running long?** Cut Scene 7 (guardian tools) first, then the last sentence of Scene 3's
  narration. Keep Scene 4: it's the answer to "what if the scammer coaches her to pay someone she
  trusts?"
- **The backend tunnel must be running** while recording the voice scenes, because ElevenLabs calls
  the backend's public address for every tool call. Re-run `npm run elevenlabs:setup -- <backend
  URL>` if the tunnel restarted.
- **Capture system audio** so the agent's voice and the scam call are in the video (OBS, or Xbox
  Game Bar with Win + Alt + R). Edit in Clipchamp or similar.
- **Two windows:** a narrow, phone-sized one for Dorothy (`/`) and a wide one for Sam (`/family`).
- **Record Scene 6 separately** with `--step`, and zoom into Explorer's error line.
