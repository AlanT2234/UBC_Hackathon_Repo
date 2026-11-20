<p align="center">
  <img src="SafeNSound-logos/final/png/safensound-lockup-on-midnight.png" alt="SafeNSound" width="420">
</p>

# SafeNSound

**Voice payments for seniors, with rules no scammer can talk past.** Dorothy pays her bills by
talking to an ElevenLabs voice assistant. A Solana program holds her everyday spending balance and
enforces the rules that protect it: a per-payment limit, a weekly cap, a list of approved payees,
escrowed holds that need a family guardian's approval, and freezes. Anything new or unusual waits
in escrow for her family; if nobody approves, the money goes back to her balance.

> *The language model proposes; the Solana program disposes.*

- **Senior view:** a large-print screen with her balance and one big "Talk to SafeNSound" button.
- **Guardian view:** approvals, payment history, payees, rules and a pause-everything control for
  her family (the guardians).
- **Scam protection:** scam signs in what she says, or in a call from an unknown number, pause her
  payments and alert the guardians.

## How it works

```
Dorothy ──voice──► ElevenLabs Agent ──server tools──► Backend (policy engine)
                                                         │  paid / held / refused
                                                         ▼
                                   Solana program safespend_vault (devnet)
                                   limits · payee list · escrow holds · freeze
                                                         ▲
Guardians ──── Guardian view (approve / decline / pause / payees) ────┘
```

1. Dorothy asks to pay someone. The agent repeats the payee and amount, waits for "yes", and calls
   the backend's `request_payment` tool with her own words and its own scam judgement.
2. The backend's policy engine decides:
   - **Paid** at once if it's a saved payee, within her limits, with no scam signs.
   - **Held** in escrow for a guardian if it's someone new or over a limit.
   - **Refused** if it looks like a scam, and her payments are paused.
3. The program enforces the limits regardless of what the backend or the agent asks for. A
   jailbroken assistant can't send more than the per-payment limit, pay someone who isn't on her
   list, or pay anything while she's frozen.

## Repo layout

| Path | What |
|---|---|
| `app/`, `components/`, `lib/` | Next.js dashboard: senior view (`/`, `/activity`) and guardian view (`/family`, `/family/history`, `/family/payees`, `/family/rules`) |
| `backend/` | TypeScript (Node + Fastify) backend: policy engine, ElevenLabs server tools, guardian API, scam scorer, alerts, hold-expiry scheduler ([backend README](backend/README.md)) |
| `programs/safespend_vault/` | Anchor 1.2.2 Solana program and its tests |
| `idl/` | The program's interface (IDL) |
| `docs/` | [Setup and presentation runbook](docs/elevenlabs-setup.md), [demo video script](docs/video-script.md) |
| `public/demo-call/`, `lib/demo-call.json` | The scripted scam call and its ElevenLabs text-to-speech audio |
| `SafeNSound-logos/` | Logo and icon set |

**Naming:** the product was called SafeSpend until Nov 20. Code identifiers keep that name
(`safespend_vault`, `SafeSpendError`, `@safespend/backend`, the `x-safespend-tool-secret` header)
because the program is deployed under it.

## Run it

Requires Node 22 or later.

```bash
# Backend (http://localhost:8787)
cd backend
cp .env.example .env
npm install
npm run dev
npm test          # 66 tests

# Dashboard (http://localhost:3000), from the repo root
cp .env.example .env.local
npm install
npm run dev
```

The defaults point the two at each other. With the backend's `DASHBOARD_TOKEN` set, set
`NEXT_PUBLIC_DASHBOARD_TOKEN` to the same value. To use the real voice agent, the backend needs a
public URL and the ElevenLabs agent ID; [docs/elevenlabs-setup.md](docs/elevenlabs-setup.md) walks
through it, including hosting both sides publicly with Cloudflare tunnels.

## Solana program

`safespend_vault` is deployed on **devnet** as
[`EDNVa6JcB6sabYhnhGiAhvLvPLBGLmiJRTnixFPS4RM8`](https://explorer.solana.com/address/EDNVa6JcB6sabYhnhGiAhvLvPLBGLmiJRTnixFPS4RM8?cluster=devnet),
with its IDL published onchain. Build and test it in the dev container (`.devcontainer/`, Solana
4.1.2 and Anchor 1.2.2), for example in a GitHub Codespace:

```bash
anchor build
cargo test -p safespend_vault   # 21 LiteSVM tests with a controlled clock
```

| Instruction | Signer | Effect |
|---|---|---|
| `init_vault` | senior (+ fee payer) | Vault PDA `["vault", senior]` with its USDC token account, 1–3 guardians, limits and delays |
| `add_payee` | senior or guardian | Payee-list entry `["payee", vault, recipient]`; active at once during onboarding, after a 24-hour delay afterwards |
| `remove_payee` | senior or guardian | Immediate: it can only narrow where money goes |
| `complete_setup` | senior | Ends onboarding |
| `pay` | agent session key | Instant transfer to an active payee within the per-payment limit and the weekly cap |
| `request_hold` | agent session key | Moves funds into a per-hold escrow with an approval deadline; at most 5 open |
| `approve` | guardian | Releases the hold at 1 approval, or 2 for amounts at or above the big-amount threshold |
| `reject` / `expire` | senior or guardian / anyone after the deadline | Refunds the escrow to her balance (works while frozen) |
| `freeze` / `unfreeze` | a guardian or the scam sentinel / a guardian | Freezing blocks `pay`, `request_hold` and `approve` |
| `request_unfreeze` / `execute_unfreeze` | senior / anyone after the delay | The senior's ~48-hour self-unfreeze |

The agent's key can only `pay` and `request_hold` within policy, and freeze as the scam sentinel. It
can never approve, unfreeze, or add payees.

**Onchain demo:** `npm run devnet -- setup` then `npm run devnet -- run --step` (in `backend/`)
drives a real vault on devnet: an instant payment, then an over-limit "jailbreak" payment, a payment
to someone not on her list, and a payment while frozen, each **rejected by the program**, with a
Solana Explorer link for every transaction.

## ElevenLabs

- **ElevenLabs Agents:** the "SafeNSound Assistant" voice agent Dorothy talks to. It has four server
  tools on the backend (`get_balance`, `list_payees`, `request_payment`, `get_pending_status`)
  called with a shared secret header. Its prompt makes it repeat every payee and amount before
  paying, pass along her own words, and give its own scam judgement, which can only raise the risk.
  `npm run elevenlabs:setup` (in `backend/`) creates or updates the agent and tools.
- **ElevenLabs text-to-speech:** the voices in the demo scam call (`npm run demo-audio` regenerates
  them from `lib/demo-call.json`).

## Scam protection

Two layers score what Dorothy tells the assistant and the transcript of a call from an unknown
number. The higher score wins:

1. **Keyword rules**, instant: gift cards, crypto ATMs, secrecy, pretending to be the government,
   a bank or tech support, bail, wires, requests for passwords, PINs, one-time codes or card digits,
   and moving money to a "safe" account.
2. **The voice agent's own judgement** (`scam_concern` on `request_payment`), which can only raise
   the risk.

Any clear scam sign in what she says makes the payment wait for a guardian, even to someone she
already pays; strong signs (several together, or the assistant judging it a clear scam) are refused
and pause all payments. A scam call pauses payments too, and for 15 minutes after it even ordinary
payments wait for a guardian. These checks are SafeNSound's, not the contract's (the Rules page says
so); the contract enforces the resulting pause. An optional Claude layer
(`backend/src/scam/llm.ts`) can be switched on with an Anthropic API key; it is off in the demo.

## Honest disclosure (demo shortcuts)

- **Devnet and test USDC only.** The dashboard's backend runs on `MockVaultClient`, an in-memory
  mirror of the program that enforces the same rules; its signatures start with `mock-` and have no
  Explorer link. The same rules run onchain in the devnet demo above.
- **Server-held keys.** Guardian and senior keys are held by the backend for the demo, and the
  dashboard acts as the first guardian who hasn't approved yet. The target design is embedded
  passkey wallets.
- **The scam call is a recording.** The guardian view's "Play demo scam call" replays a scripted
  call (ElevenLabs voices) through the same `/api/calls` scoring endpoints a live call would use;
  the risk, highlighted words and freeze come from the real scorer. The Twilio bridge that would
  listen to real calls is not built.
- **Payees are added by name** and get server-generated addresses; real payouts (bank payouts or
  claim links) are roadmap.
- **State is in memory** and resets when the backend restarts.
- **No chain indexer is connected.** A production deployment would need one (for example QuickNode
  Streams or a Solana log subscription) to see approvals guardians sign on their own devices.
