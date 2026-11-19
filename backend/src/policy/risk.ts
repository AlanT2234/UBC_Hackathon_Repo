import type { Units } from '../domain/types.js';
import { ratio } from '../money.js';

export interface RiskInputs {
  newPayee: boolean;
  amount: Units;
  weeklyCap: Units;
  /** 0..1 from the scam scorer (live call + agent conversation). */
  scamCue: number;
  /** Payment requests in the velocity window, including this one. */
  recentRequests: number;
}

export interface RiskBreakdown {
  total: number;
  signals: { newPayee: number; amount: number; scamCue: number; velocity: number };
}

export const RISK_WEIGHTS = { newPayee: 0.25, amount: 0.2, scamCue: 0.45, velocity: 0.1 } as const;

/** R = Σ wᵢ·sᵢ ∈ [0, 1]. Secondary to the onchain rules: it only splits held from refused. */
export function scoreRisk(i: RiskInputs): RiskBreakdown {
  const signals = {
    newPayee: i.newPayee ? 1 : 0,
    amount: Math.min(1, ratio(i.amount, i.weeklyCap)),
    scamCue: Math.min(1, Math.max(0, i.scamCue)),
    // The first request is free; five or more in the window saturates.
    velocity: Math.min(1, Math.max(0, i.recentRequests - 1) / 4),
  };
  const total =
    RISK_WEIGHTS.newPayee * signals.newPayee +
    RISK_WEIGHTS.amount * signals.amount +
    RISK_WEIGHTS.scamCue * signals.scamCue +
    RISK_WEIGHTS.velocity * signals.velocity;
  return { total: Math.round(total * 1000) / 1000, signals };
}
