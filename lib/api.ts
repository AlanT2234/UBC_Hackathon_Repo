import { formatDollars } from "@/lib/format";
import type { Account, Payment, Rule, VoiceRequest } from "@/lib/types";

/**
 * Mock of the Arc contract. The assistant and the screens call only these
 * functions. Nothing here can be skipped from the UI: approve, decline, and
 * a spoken request all run through decide().
 */

const SENIOR_NAME = "Margaret Hale";

const KNOWN_RECIPIENTS = [
  "city power",
  "greenline pharmacy",
  "oak street dental",
  "maple market",
];

function atHour(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function seedRules(): Rule[] {
  return [
    {
      id: "daily",
      title: "Daily limit",
      summary: "$200 a day",
      detail: "Payments that would go over today's limit wait for a family member.",
      locked: false,
      limitCents: 20000,
    },
    {
      id: "single",
      title: "Single payment",
      summary: "$100 at a time",
      detail: "A larger payment to someone she already pays waits for a family member.",
      locked: false,
      limitCents: 10000,
    },
    {
      id: "new-person",
      title: "New people",
      summary: "Always ask family",
      detail: "The first payment to someone new waits for a family member.",
      locked: true,
      limitCents: null,
    },
    {
      id: "gift-cards",
      title: "Gift cards",
      summary: "Always blocked",
      detail: "Gift cards are a common scam. The contract refuses them. No one can turn this off.",
      locked: true,
      limitCents: null,
    },
  ];
}

function seedPayments(): Payment[] {
  return [
    {
      id: "pay_dental",
      amountCents: 24000,
      recipientName: "Oak Street Dental",
      purpose: "Cleaning and checkup",
      status: "held",
      reason:
        "This is over the single-payment limit of $100.00, so a family member must approve it.",
      requestedAt: atHour(0, 9, 40),
      decidedAt: null,
    },
    {
      id: "pay_power",
      amountCents: 8640,
      recipientName: "City Power",
      purpose: "Electric bill",
      status: "paid",
      reason: "Within the rules. The contract sent the payment.",
      requestedAt: atHour(1, 11, 5),
      decidedAt: atHour(1, 11, 5),
    },
    {
      id: "pay_pharmacy",
      amountCents: 4218,
      recipientName: "Greenline Pharmacy",
      purpose: "Prescription",
      status: "paid",
      reason: "Within the rules. The contract sent the payment.",
      requestedAt: atHour(1, 16, 20),
      decidedAt: atHour(1, 16, 20),
    },
    {
      id: "pay_market",
      amountCents: 6320,
      recipientName: "Maple Market",
      purpose: "Groceries",
      status: "paid",
      reason: "Within the rules. The contract sent the payment.",
      requestedAt: atHour(2, 13, 15),
      decidedAt: atHour(2, 13, 15),
    },
    {
      id: "pay_gift",
      amountCents: 50000,
      recipientName: "Quick Gift Cards",
      purpose: "Gift cards",
      status: "blocked",
      reason: "Gift cards are always blocked by the contract.",
      requestedAt: atHour(3, 19, 2),
      decidedAt: atHour(3, 19, 2),
    },
  ];
}

type State = {
  balanceCents: number;
  rules: Rule[];
  payments: Payment[];
};

let state: State = {
  balanceCents: 428016,
  rules: seedRules(),
  payments: seedPayments(),
};

type Listener = () => void;
const listeners = new Set<Listener>();

export type Snapshot = {
  account: Account;
  payments: Payment[];
  rules: Rule[];
};

let snapshot: Snapshot = buildSnapshot();

function buildSnapshot(): Snapshot {
  const pendingCount = state.payments.filter((payment) => payment.status === "held").length;
  return {
    account: {
      seniorName: SENIOR_NAME,
      balanceCents: state.balanceCents,
      pendingCount,
    },
    payments: state.payments,
    rules: state.rules,
  };
}

function commit() {
  snapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

function wait(ms = 700): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rule(id: string): Rule {
  const found = state.rules.find((item) => item.id === id);
  if (!found) throw new Error(`Missing rule ${id}`);
  return found;
}

function isGiftCard(recipientName: string, purpose: string): boolean {
  const text = `${recipientName} ${purpose}`.toLowerCase();
  return text.includes("gift card");
}

function isKnown(recipientName: string): boolean {
  const name = recipientName.trim().toLowerCase();
  if (KNOWN_RECIPIENTS.includes(name)) return true;
  return state.payments.some(
    (payment) =>
      payment.recipientName.toLowerCase() === name && payment.status === "paid",
  );
}

function spentToday(): number {
  const now = new Date();
  return state.payments
    .filter((payment) => {
      if (payment.status !== "paid" || !payment.decidedAt) return false;
      const decided = new Date(payment.decidedAt);
      return (
        decided.getFullYear() === now.getFullYear() &&
        decided.getMonth() === now.getMonth() &&
        decided.getDate() === now.getDate()
      );
    })
    .reduce((sum, payment) => sum + payment.amountCents, 0);
}

/** The contract. Callers receive a decision. They do not choose the status. */
function decide(input: VoiceRequest): Pick<Payment, "status" | "reason"> {
  if (isGiftCard(input.recipientName, input.purpose)) {
    return {
      status: "blocked",
      reason: "Gift cards are always blocked by the contract.",
    };
  }

  if (!isKnown(input.recipientName)) {
    return {
      status: "held",
      reason: "This person is new, so a family member must approve the payment.",
    };
  }

  const single = rule("single").limitCents ?? 0;
  if (input.amountCents > single) {
    return {
      status: "held",
      reason: `This is over the single-payment limit of ${formatDollars(single)}, so a family member must approve it.`,
    };
  }

  const daily = rule("daily").limitCents ?? 0;
  if (spentToday() + input.amountCents > daily) {
    return {
      status: "held",
      reason: `This would go over today's limit of ${formatDollars(daily)}, so a family member must approve it.`,
    };
  }

  return {
    status: "paid",
    reason: "Within the rules. The contract sent the payment.",
  };
}

export async function getAccount(): Promise<Account> {
  await wait(120);
  return getSnapshot().account;
}

export async function listPayments(): Promise<Payment[]> {
  await wait(120);
  return getSnapshot().payments;
}

export async function getPayment(id: string): Promise<Payment | null> {
  await wait(120);
  return getSnapshot().payments.find((payment) => payment.id === id) ?? null;
}

export async function listRules(): Promise<Rule[]> {
  await wait(120);
  return getSnapshot().rules;
}

export async function saveRule(id: string, limitCents: number): Promise<Rule> {
  await wait();
  const current = rule(id);
  if (current.locked || current.limitCents === null) {
    throw new Error("This rule is enforced by the contract and cannot be changed here.");
  }
  if (!Number.isFinite(limitCents) || limitCents < 0) {
    throw new Error("Enter a dollar amount.");
  }

  const summary =
    id === "daily"
      ? `${formatDollars(limitCents)} a day`
      : `${formatDollars(limitCents)} at a time`;

  state = {
    ...state,
    rules: state.rules.map((item) =>
      item.id === id ? { ...item, limitCents, summary } : item,
    ),
  };
  commit();
  return rule(id);
}

export async function submitVoicePayment(input: VoiceRequest): Promise<Payment> {
  await wait();
  const decision = decide(input);
  const now = new Date().toISOString();
  const payment: Payment = {
    id: `pay_${Date.now()}`,
    amountCents: input.amountCents,
    recipientName: input.recipientName,
    purpose: input.purpose,
    status: decision.status,
    reason: decision.reason,
    requestedAt: now,
    decidedAt: decision.status === "held" ? null : now,
  };

  const balanceCents =
    decision.status === "paid" ? state.balanceCents - input.amountCents : state.balanceCents;

  state = {
    ...state,
    balanceCents,
    payments: [payment, ...state.payments],
  };
  commit();
  return payment;
}

export async function approvePayment(id: string): Promise<Payment> {
  await wait();
  const current = state.payments.find((payment) => payment.id === id);
  if (!current) throw new Error("That payment could not be found.");
  if (current.status !== "held") return current;

  const now = new Date().toISOString();
  let next: Payment;

  if (isGiftCard(current.recipientName, current.purpose)) {
    next = {
      ...current,
      status: "blocked",
      decidedAt: now,
      reason: "The contract blocked this. Family approval cannot override it.",
    };
  } else {
    next = {
      ...current,
      status: "paid",
      decidedAt: now,
      reason: "A family member approved it. The contract sent the payment.",
    };
  }

  state = {
    ...state,
    balanceCents:
      next.status === "paid" ? state.balanceCents - next.amountCents : state.balanceCents,
    payments: state.payments.map((payment) => (payment.id === id ? next : payment)),
  };
  commit();
  return next;
}

export async function declinePayment(id: string): Promise<Payment> {
  await wait();
  const current = state.payments.find((payment) => payment.id === id);
  if (!current) throw new Error("That payment could not be found.");
  if (current.status !== "held") return current;

  const next: Payment = {
    ...current,
    status: "blocked",
    decidedAt: new Date().toISOString(),
    reason: "Your family declined this payment. The contract did not send it.",
  };

  state = {
    ...state,
    payments: state.payments.map((payment) => (payment.id === id ? next : payment)),
  };
  commit();
  return next;
}

export const SAMPLE_REQUESTS: VoiceRequest[] = [
  {
    recipientName: "City Power",
    purpose: "Electric bill",
    amountCents: 8640,
    said: "Please pay City Power $86.40 for the electric bill.",
  },
  {
    recipientName: "Daniel Okonkwo",
    purpose: "He said the bank needed this today",
    amountCents: 150000,
    said: "Please send $1,500.00 to Daniel. He said the bank needs it today.",
  },
  {
    recipientName: "Quick Gift Cards",
    purpose: "Gift cards",
    amountCents: 50000,
    said: "Please buy $500.00 in gift cards.",
  },
];
