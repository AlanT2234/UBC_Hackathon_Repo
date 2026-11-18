export type PaymentStatus = "paid" | "held" | "blocked";

export type Payment = {
  id: string;
  amountCents: number;
  recipientName: string;
  purpose: string;
  status: PaymentStatus;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
};

export type Rule = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  /** Hard rules stay on, even if a person asks the assistant to ignore them. */
  locked: boolean;
  limitCents: number | null;
};

export type Account = {
  seniorName: string;
  balanceCents: number;
  pendingCount: number;
};

export type AgentPhase =
  | "idle"
  | "listening"
  | "checking"
  | "paid"
  | "held"
  | "blocked";

export type VoiceRequest = {
  recipientName: string;
  purpose: string;
  amountCents: number;
  said: string;
};
