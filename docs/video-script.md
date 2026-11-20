# SafeNSound demo video script

Submission requirement: a **2–3 minute** video, **with ElevenLabs audio**, on YouTube or Google
Drive and viewable by the judges. Target length: **≈2:50**. The narration is about 330 words; the
rest of the time is demo audio and pauses.

- **Narrator**: the voiceover.
- **Dorothy**: spoken into the senior view's microphone.
- *(Agent: …)*: what SafeNSound says back. Its wording varies a little between takes.

Setup, recording tips and troubleshooting are in [elevenlabs-setup.md](elevenlabs-setup.md).

---

## Scene 1: Hook (0:00–0:15)

**On screen:** SafeNSound logo, then fade to Dorothy's senior view showing $1,200.

**Narrator:**
> Older Americans lose billions of dollars a year to scams, often in a single phone call. This is SafeNSound. Dorothy pays her bills just by talking, and the rules that protect her money can't be talked out of.

## Scene 2: Paid (0:15–0:40)

**On screen:** Dorothy taps **Talk to SafeNSound**.

*(Agent: "Hello Dorothy, it's SafeNSound. Who would you like to pay today?")*

**Dorothy:**
> Pay City Electric eighty-six dollars and forty cents for the electric bill.

*(The agent repeats the payee and amount.)*

**Dorothy:**
> Yes, please.

*(The card shows **Paid** and the balance drops.)*

**Narrator** (over the Paid card):
> City Electric is a payee her family already approved, and the amount is within her limits, so it goes through right away.

## Scene 3: Held, then approved (0:40–1:15)

**Dorothy:**
> Pay Mike's Plumbing four hundred dollars. He fixed my sink.

*(The agent repeats it; Dorothy says "Yes." Agent: "I don't know Mike's Plumbing yet, so I've put 400 dollars on hold and asked Sam…")*

**Narrator** (as the card shows **Waiting for family**):
> Mike is new, and four hundred dollars is over her limit. So the money moves into escrow, and her grandson Sam is asked to approve.

**On screen:** cut to the Guardian view. The held payment, then Sam clicks **Approve as Sam**, then **Paid**.

**Narrator:**
> Sam checks with her and approves. If nobody had answered, the money would simply go back to her balance.

## Scene 4: The scam call (1:15–1:55)

**On screen:** Guardian view. Click **Play demo scam call** with sound on.

**On-screen caption** (keep it up for the whole scene): *Recorded scam call, replayed through SafeNSound's call-scoring pipeline.*

**Narrator** (one line before the audio starts):
> SafeNSound is built to listen to calls from unknown numbers. Here's a recorded scam call.

*(Let the call play: the "fraud department", "act right away", "last four digits of your credit card". The freeze lands on line 4. Let a line or two more play, then lower the volume.)*

**Narrator** (once the **Payments paused** badge is showing):
> A fake bank, pressure to act fast, and a request for her card number. SafeNSound recognises the scam and freezes her payments before she can act.

**On screen:** cut to Dorothy's view. She taps **Talk to SafeNSound**.

**Dorothy:**
> Pay the bank five hundred dollars.

*(Agent: "Payments are paused right now while your guardians check on something. Your money is safe.")*

## Scene 5: Onchain proof (1:55–2:25)

**On screen:** terminal running `npm run devnet -- run --step` (from `backend/`), then Solana Explorer showing the rejected transactions.

**Narrator:**
> The voice assistant never decides. The rules live in a Solana program. Here, the assistant's own key tries to send nine hundred dollars, and the program rejects it. A payment to someone not on her list: rejected. And once the vault is frozen, even twenty dollars is refused. No voice, script or jailbroken AI can override the program.

## Scene 6: Guardian tools (2:25–2:45)

**On screen:** a quick pan through Payment history (filters, Download CSV), Payees (the 24-hour badge) and Rules.

**Narrator:**
> Her family sees every payment and why it was paid, held or stopped. New payees wait twenty-four hours, so a scammer can't rush her. And anyone in the family can pause everything with one tap.

## Scene 7: Close (2:45–2:55)

**On screen:** SafeNSound logo.

**Narrator:**
> SafeNSound: voice payments that keep seniors safe and sound. Built with ElevenLabs Agents and text-to-speech, and Solana.

---

## Notes before recording

- **Don't imply live phone listening.** The Twilio call bridge isn't built, which is why Scene 4
  says "built to listen" and "recorded scam call", and why the caption stays on screen. Keep it
  that way, so a judge can't fairly say the video overclaims.
- **Scene 4's payment line is deliberately plain** ("Pay the bank five hundred dollars"), because
  payments are already paused. Any request shows the freeze, and you don't need scam words to
  trigger it.
- **ElevenLabs credit:** the closing line names both products used, Agents for the assistant and
  text-to-speech for the scam call's voices. That helps with the bounty's "shows the
  integration" criterion.
- **Running long?** Cut the second half of Scene 3's narration ("If nobody had answered…") and
  shorten Scene 6 to one sentence. That saves about 15 seconds.
- **Restart the backend before each full take.** After Scene 4, payments stay held for 15 minutes.
- **The backend tunnel must be running** while recording the voice scenes, because ElevenLabs calls
  the backend's public address for every tool call. Re-run `npm run elevenlabs:setup -- <backend
  URL>` if the tunnel restarted.
- **Capture system audio** so the agent's voice and the scam call are in the video (OBS, or Xbox
  Game Bar with Win + Alt + R). Edit in Clipchamp or similar.
- **Two windows:** a narrow, phone-sized one for Dorothy (`/`) and a wide one for Sam (`/family`).
- **Record Scene 5 separately** with `--step`, and zoom into Explorer's error line.
