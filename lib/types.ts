export type PaymentStatus = "paid" | "held" | "blocked";

/** The exact end state, for the itemized history. `status` folds the last three into "blocked". */
export type PaymentOutcome = "paid" | "held" | "refused" | "declined" | "expired";

export type Payment = {
  id: string;
  amountCents: number;
  recipientName: string;
  purpose: string;
  status: PaymentStatus;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  outcome: PaymentOutcome;
  /** Guardian keys that have approved a held payment. */
  approvals: string[];
  /** Names for `approvals`, in approval order. */
  approvedBy: string[];
  /** Seconds left to approve a held payment. */
  expiresInSeconds: number | null;
  approvalsRequired: number;
  explorerUrl: string | null;
};

export type Rule = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  /** Hard rules stay on, even if a person asks the assistant to ignore them. */
  locked: boolean;
  /** Who enforces it: the Solana program, or SafeNSound's scam checks (which then use the program's freeze). */
  enforcedBy: "contract" | "safensound";
  limitCents: number | null;
};

/** Someone on the vault's approved list. New payees wait out the contract's change delay. */
export type Payee = {
  recipient: string;
  name: string;
  aliases: string[];
  /** False until the waiting period after adding has passed. */
  active: boolean;
  activeAt: string;
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
