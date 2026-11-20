# SafeSpend backend

TypeScript (Node 24 + Fastify) backend: policy engine, ElevenLabs server tools, guardian API,
QuickNode webhook, scam-call scorer, guardian alerts and the hold-expiry scheduler.

```bash
cd backend
cp .env.example .env   # optional; defaults work for local dev
npm install
npm test               # 41 tests
npm run dev            # http://localhost:8787
```

It currently runs on `MockVaultClient`, an in-memory vault that enforces the same rules as the
`safespend_vault` Solana program (deployed on devnet as `EDNVa6JcB6sabYhnhGiAhvLvPLBGLmiJRTnixFPS4RM8`).
It boots with Dorothy's demo vault: $1,200, $100 per payment, $300/week, guardians Sam, Priya and
Maple Credit Union (professional), payees Maria, City Electric and Tyler.

## Endpoints

**ElevenLabs server tools** (`POST`, header `x-safespend-tool-secret`); every response has a `message` to read aloud:
`/tools/get_balance`, `/tools/list_payees`, `/tools/request_payment` `{ payee_name, amount, memo? }`
→ `outcome: paid | held | refused | clarify`, `/tools/get_pending_status`.

**Dashboard API** (`Authorization: Bearer $DASHBOARD_TOKEN`, or `?token=` for SSE):

- `GET /api/vaults/:vault`, `/payees`, `/holds`, `/payments` (history with outcomes, refusals included), `/events`
- `POST /api/vaults/:vault/holds/:hold/approve` `{ guardian }`, `/reject` `{ signer }`
- `POST /api/vaults/:vault/freeze` `{ guardian }`, `/unfreeze` `{ guardian }`, `/request-unfreeze` `{ signer }`
- `GET /api/events/stream`: server-sent events (`vault` = program events, `payment` = history changes, `call` = live call updates)
- `POST /api/calls`, `/api/calls/:id/transcript` `{ text }`, `/api/calls/:id/end`: live call listening
- Demo only (`DEMO_ROUTES=true`): `GET /api/demo` (demo keys), `POST /api/demo/request-payment` `{ payee_name, amount, memo? }` (the policy engine path, for the dashboard's sample requests), `POST /api/demo/force-pay`, `POST /api/demo/fund`

**QuickNode Streams:** `POST /webhooks/quicknode?token=$WEBHOOK_TOKEN`, body `{ events: VaultEvent[] }`.

With no `.env`, all tokens are unset and every endpoint is open: fine locally, but set `TOOL_SECRET`,
`DASHBOARD_TOKEN` and `WEBHOOK_TOKEN` before exposing it publicly.
