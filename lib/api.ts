import type { Account, AgentPhase, Payment, Rule, VoiceRequest } from "@/lib/types";

/**
 * Client for the SafeNSound backend. The assistant and the screens call only these functions.
 * Nothing here decides anything: the backend's policy engine routes each request and the
 * Solana program enforces the limits. Screens read a snapshot that refreshes over SSE.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
// Demo shortcut: the dashboard token ships in the browser bundle. Fine for a local demo only.
const TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN ?? "";

type Usd = { units: string; display: string };

type VaultView = {
  address: string;
  owner: string | null;
  balance: Usd;
  perPaymentLimit: Usd;
  weeklyCap: Usd;
  weeklyRemaining: Usd;
  bigAmountThreshold: Usd;
  frozen: boolean;
  unfreezeEffectiveAt: number | null;
  guardians: { key: string; name: string | null; professional: boolean }[];
  holdSeconds: number;
};

type PaymentView = {
  id: string;
  payee: string;
  amount: Usd;
  memo: string | null;
  status: "paid" | "held" | "refused" | "declined" | "expired";
  reasons: string[];
  requestedAt: number;
  decidedAt: number | null;
  hold: string | null;
  expiresInSeconds: number | null;
  approvalsRequired: number;
  approvals: { key: string; name: string | null }[];
  explorerUrl: string | null;
};

type DecisionView = {
  outcome: "paid" | "held" | "refused" | "clarify" | "error";
  message: string;
};

type DemoIds = {
  vault: string;
  senior: string;
  guardians: Record<string, string>;
};

export type Connection = "connecting" | "live" | "offline";

export type Guardian = { key: string; name: string };

export type Snapshot = {
  connection: Connection;
  account: Account;
  payments: Payment[];
  rules: Rule[];
  frozen: boolean;
  guardians: Guardian[];
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("SafeNSound could not be reached. Check that the backend is running.", null);
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!res.ok) {
    throw new ApiError(errorMessage(data?.error ?? null, data?.message), data?.error ?? null);
  }
  return data as T;
}

const ERROR_MESSAGES: Record<string, string> = {
  Frozen: "Payments are paused. Unfreeze the account first.",
  HoldExpired: "This payment expired. The money went back to her balance.",
  HoldNotFound: "This payment is already finished.",
  AlreadyApproved: "You already approved this payment.",
  NotGuardian: "Only a family guardian can do this.",
  NotFrozen: "Payments are not paused.",
  AlreadyFrozen: "Payments are already paused.",
  unauthorized: "The dashboard token was not accepted.",
};

function errorMessage(code: string | null, message?: string): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return message ?? "SafeNSound did not answer. Try again.";
}

function cents(usd: Usd): number {
  // Base units have 6 decimals; the screens work in cents.
  return Number(BigInt(usd.units) / BigInt(10_000));
}

function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function sentence(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function reasonFor(p: PaymentView): string {
  const why = p.reasons.map(sentence).join(". ");
  switch (p.status) {
    case "paid":
      if (p.hold) {
        const names = p.approvals.map((a) => a.name ?? "A guardian").join(" and ");
        return `${names || "Family"} approved it. The program sent the payment.`;
      }
      return "Within her limits. The program sent the payment.";
    case "held": {
      const waiting =
        p.approvalsRequired > 1
          ? `It needs ${p.approvalsRequired} family approvals (${p.approvals.length} so far).`
          : "A family member must approve it.";
      return `${why ? `${why}. ` : ""}${waiting}`;
    }
    case "refused":
      return `Refused: ${p.reasons.join(", ") || "this looked unusual"}. No money moved.`;
    case "declined":
      return "Family declined this payment. The money went back to her balance.";
    case "expired":
      return "Nobody approved it in time, so the money went back to her balance.";
  }
}

function toPayment(p: PaymentView): Payment {
  return {
    id: p.id,
    amountCents: cents(p.amount),
    recipientName: p.payee,
    purpose: p.memo ?? "",
    status: p.status === "paid" ? "paid" : p.status === "held" ? "held" : "blocked",
    outcome: p.status,
    reason: reasonFor(p),
    requestedAt: iso(p.requestedAt),
    decidedAt: p.decidedAt === null ? null : iso(p.decidedAt),
    approvals: p.approvals.map((a) => a.key),
    approvedBy: p.approvals.map((a) => a.name ?? "A guardian"),
    expiresInSeconds: p.expiresInSeconds,
    approvalsRequired: p.approvalsRequired,
    explorerUrl: p.explorerUrl,
  };
}

function toRules(v: VaultView): Rule[] {
  // Under an hour reads in minutes ("30 minutes"); rounding 0.5 h up to "1 hour" overstated it.
  const minutes = Math.round(v.holdSeconds / 60);
  const hours = v.holdSeconds / 3600;
  const window =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? "" : "s"}`
      : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;
  return [
    {
      id: "single",
      title: "Single payment",
      summary: `${v.perPaymentLimit.display} at a time`,
      detail: "A larger payment, even to someone she already pays, waits for a family member.",
      locked: true,
      limitCents: cents(v.perPaymentLimit),
    },
    {
      id: "weekly",
      title: "Weekly limit",
      summary: `${v.weeklyCap.display} a week (${v.weeklyRemaining.display} left)`,
      detail: "Payments that would go over this week's limit wait for a family member.",
      locked: true,
      limitCents: cents(v.weeklyCap),
    },
    {
      id: "new-person",
      title: "New people",
      summary: "Always ask family",
      detail: "Payments to someone who is not a saved payee wait for a family member.",
      locked: true,
      limitCents: null,
    },
    {
      id: "big",
      title: "Big payments",
      summary: `${v.bigAmountThreshold.display} and up needs two people`,
      detail: "Large held payments need two family guardians to approve.",
      locked: true,
      limitCents: cents(v.bigAmountThreshold),
    },
    {
      id: "window",
      title: "Approval window",
      summary: `${window} to approve`,
      detail: "If nobody approves a held payment in time, the money goes back to her balance.",
      locked: true,
      limitCents: null,
    },
    {
      id: "scams",
      title: "Scam warning signs",
      summary: "Always refused",
      detail:
        "Gift cards, secrecy and pressure are common scam signs. SafeNSound refuses the payment and pauses the account.",
      locked: true,
      limitCents: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Snapshot store

let snapshot: Snapshot = {
  connection: "connecting",
  // Empty until the first load; screens fall back to neutral wording rather than a placeholder name.
  account: { seniorName: "", balanceCents: 0, pendingCount: 0 },
  payments: [],
  rules: [],
  frozen: false,
  guardians: [],
};

let ids: DemoIds | null = null;
const listeners = new Set<() => void>();
let source: EventSource | null = null;
let poll: number | null = null;
let lastEventAt = 0;

/** Some proxies (Cloudflare quick tunnels) hold SSE back; poll whenever the stream has gone quiet. */
const POLL_MS = 4000;
const QUIET_MS = 10_000;
let refreshing: Promise<void> | null = null;
let again = false;

function commit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

async function demoIds(): Promise<DemoIds> {
  ids ??= await request<DemoIds>("/api/demo");
  return ids;
}

async function load(): Promise<void> {
  const { vault } = await demoIds();
  const [v, payments] = await Promise.all([
    request<VaultView>(`/api/vaults/${vault}`),
    request<PaymentView[]>(`/api/vaults/${vault}/payments`),
  ]);
  const list = payments.map(toPayment);
  commit({
    connection: "live",
    account: {
      seniorName: v.owner ?? "your family member",
      balanceCents: cents(v.balance),
      pendingCount: list.filter((p) => p.status === "held").length,
    },
    payments: list,
    rules: toRules(v),
    frozen: v.frozen,
    guardians: v.guardians
      .filter((g) => !g.professional)
      .map((g) => ({ key: g.key, name: g.name ?? "Guardian" })),
  });
}

/** Coalesces bursts of SSE events into one reload at a time. */
export function refresh(): Promise<void> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = load()
    .catch(() => commit({ connection: "offline" }))
    .finally(() => {
      refreshing = null;
      if (again) {
        again = false;
        void refresh();
      }
    });
  return refreshing;
}

function connect() {
  if (source || typeof window === "undefined") return;
  const query = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "";
  source = new EventSource(`${API_URL}/api/events/stream${query}`);
  const onEvent = () => {
    lastEventAt = Date.now();
    void refresh();
  };
  source.addEventListener("ready", onEvent);
  source.addEventListener("vault", onEvent);
  source.addEventListener("payment", onEvent);
  poll = window.setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - lastEventAt > QUIET_MS) void refresh();
  }, POLL_MS);
  source.onerror = () => {
    // EventSource reconnects by itself; show offline until the next successful load.
    if (source?.readyState !== EventSource.OPEN) commit({ connection: "offline" });
  };
}

function disconnect() {
  source?.close();
  source = null;
  if (poll !== null) window.clearInterval(poll);
  poll = null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    connect();
    void refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

// ---------------------------------------------------------------------------------------------
// Actions

function findPayment(id: string): Payment {
  const found = snapshot.payments.find((payment) => payment.id === id);
  if (!found) throw new ApiError("That payment could not be found.", null);
  return found;
}

/** Demo: the guardian view acts as whichever family guardian has not approved yet. */
export function approverFor(payment: Payment): Guardian | null {
  return snapshot.guardians.find((g) => !payment.approvals.includes(g.key)) ?? null;
}

function actingGuardian(): Guardian {
  const guardian = snapshot.guardians[0];
  if (!guardian) throw new ApiError("SafeNSound is still loading. Try again.", null);
  return guardian;
}

export async function approvePayment(id: string): Promise<Payment> {
  const { vault } = await demoIds();
  const guardian = approverFor(findPayment(id));
  if (!guardian) throw new ApiError("Every family guardian has already approved this.", null);
  await request(`/api/vaults/${vault}/holds/${id}/approve`, {
    method: "POST",
    body: { guardian: guardian.key },
  });
  await refresh();
  return findPayment(id);
}

export async function declinePayment(id: string): Promise<Payment> {
  const { vault } = await demoIds();
  await request(`/api/vaults/${vault}/holds/${id}/reject`, {
    method: "POST",
    body: { signer: actingGuardian().key },
  });
  await refresh();
  return findPayment(id);
}

export async function setFrozen(frozen: boolean): Promise<void> {
  const { vault } = await demoIds();
  await request(`/api/vaults/${vault}/${frozen ? "freeze" : "unfreeze"}`, {
    method: "POST",
    body: { guardian: actingGuardian().key },
  });
  await refresh();
}

export async function saveRule(id: string, limitCents: number): Promise<Rule> {
  void id;
  void limitCents;
  // Limit changes go through the program's 24-hour waiting period, which has no API yet.
  throw new ApiError("Limits are set in the program and can't be changed from here yet.", null);
}

const OUTCOME_PHASE: Record<DecisionView["outcome"], AgentPhase> = {
  paid: "paid",
  held: "held",
  refused: "blocked",
  clarify: "listening",
  error: "idle",
};

/** Runs a spoken request through the same policy engine path as the voice agent's tool call. */
export async function submitVoicePayment(
  input: VoiceRequest,
): Promise<{ phase: AgentPhase; message: string }> {
  const decision = await request<DecisionView>("/api/demo/request-payment", {
    method: "POST",
    body: { payee_name: input.recipientName, amount: input.amountCents / 100, memo: input.said },
  });
  void refresh();
  return { phase: OUTCOME_PHASE[decision.outcome], message: decision.message };
}

export const SAMPLE_REQUESTS: VoiceRequest[] = [
  {
    recipientName: "City Electric",
    purpose: "Electric bill",
    amountCents: 8640,
    said: "Please pay City Electric $86.40 for the electric bill.",
  },
  {
    recipientName: "Mike's Plumbing",
    purpose: "Fixed the kitchen sink",
    amountCents: 40000,
    said: "Pay Mike's Plumbing $400. He fixed the kitchen sink.",
  },
  {
    recipientName: "Daniel",
    purpose: "He said the bank needed this today",
    amountCents: 50000,
    said: "Send Daniel $500 in gift cards. He said the bank needs it today and not to tell anyone.",
  },
];

// ---------------------------------------------------------------------------------------------
// Call listening. In production, the Twilio → Scribe bridge posts transcript chunks; the demo
// replays a scripted call through the same endpoints, so the real scorer decides every line.

export type CallSession = {
  id: string;
  caller: string | null;
  transcript: { at: number; text: string }[];
  score: { risk: number; scamType: string | null; reasons: string[] };
  frozeVault: boolean;
  endedAt: number | null;
};

export function startCall(caller: string): Promise<CallSession> {
  return request<CallSession>("/api/calls", { method: "POST", body: { caller } });
}

export function sendTranscript(id: string, text: string): Promise<CallSession> {
  return request<CallSession>(`/api/calls/${id}/transcript`, { method: "POST", body: { text } });
}

export function endCall(id: string): Promise<CallSession> {
  return request<CallSession>(`/api/calls/${id}/end`, { method: "POST", body: {} });
}
