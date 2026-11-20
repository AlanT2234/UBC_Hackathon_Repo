import { isPayeeActive, weeklyRemaining } from '../domain/rules.js';
import type { Clock, Hold, Pubkey, Units, VaultState } from '../domain/types.js';
import type { AlertService } from '../alerts/service.js';
import { spokenUsd } from '../money.js';
import type { PayeeDirectory } from '../payees/directory.js';
import type { PaymentLog } from '../payments/log.js';
import type { CallMonitor } from '../scam/monitor.js';
import type { ScamScorer } from '../scam/llm.js';
import { NO_SCAM, maxScore, mergeScores, scoreText, type ScamScore } from '../scam/rules.js';
import type { VaultClient } from '../vault/client.js';
import { isVaultError } from '../vault/errors.js';
import { scoreRisk, type RiskBreakdown } from './risk.js';

export interface PolicyOptions {
  /** Below this (and with every hard rule passing) a payment goes through instantly. */
  holdThreshold: number;
  /** At or above this the payment is refused; a scam cue this strong also freezes the vault. */
  refuseThreshold: number;
  velocityWindowSeconds: number;
}

export const DEFAULT_POLICY: PolicyOptions = { holdThreshold: 0.3, refuseThreshold: 0.6, velocityWindowSeconds: 600 };

export interface PaymentRequest {
  vault: Pubkey;
  payeeName: string;
  amount: Units;
  /** What the senior said about the payment (agent conversation); scored for scam cues. */
  context?: string;
  /** The voice agent's own scam judgement of the conversation. Can only raise the risk. */
  agentConcern?: ScamScore;
}

export interface ResolvedPayee {
  recipient: Pubkey;
  name: string;
  allowlisted: boolean;
  active: boolean;
}

export type RefusalCode = 'frozen' | 'scam_suspected' | 'insufficient_funds' | 'too_many_holds' | 'invalid_amount';

export type PaymentDecision =
  | { outcome: 'paid'; payee: ResolvedPayee; amount: Units; signature: string; risk: RiskBreakdown; message: string }
  | {
      outcome: 'held';
      payee: ResolvedPayee;
      amount: Units;
      hold: Hold;
      signature: string;
      reasons: string[];
      risk: RiskBreakdown;
      message: string;
    }
  | {
      outcome: 'refused';
      code: RefusalCode;
      payee: ResolvedPayee | null;
      amount: Units;
      reasons: string[];
      risk: RiskBreakdown | null;
      message: string;
    }
  | { outcome: 'clarify'; options: string[]; amount: Units; message: string };

/** Why a payment that wasn't refused still went to a hold, for the message the senior hears. */
type HoldCause = 'rules' | 'recent_call' | 'scam_cue' | 'unusual';

export interface PolicyDeps {
  client: VaultClient;
  directory: PayeeDirectory;
  calls: CallMonitor;
  alerts: AlertService;
  now: Clock;
  /** Records every decision for the dashboard's payment history. */
  payments?: PaymentLog;
  /** LLM layer over what the senior said; keyword rules alone when absent. */
  scamScorer?: ScamScorer;
}

/**
 * Decides paid / held / refused for a spoken payment. The language model proposes; this engine
 * routes; the Solana program disposes. Hard rules come first, so a new payee is never instant,
 * and if the program rejects an instant payment the engine falls back to a hold.
 */
export class PolicyEngine {
  private readonly requests = new Map<Pubkey, number[]>();

  constructor(
    private readonly deps: PolicyDeps,
    private readonly opts: PolicyOptions = DEFAULT_POLICY,
  ) {}

  async requestPayment(req: PaymentRequest): Promise<PaymentDecision> {
    const decision = await this.decide(req);
    this.deps.payments?.noteDecision(req, decision);
    return decision;
  }

  private async decide(req: PaymentRequest): Promise<PaymentDecision> {
    const { client } = this.deps;
    const { amount } = req;
    if (amount <= 0n) {
      return this.refused('invalid_amount', null, amount, [], null, "I didn't catch the amount. How much would you like to send?");
    }
    const recentRequests = this.recordRequest(req.vault);
    // Started now so the LLM pass overlaps the vault and payee lookups. It never rejects.
    const said = this.scoreSaid(req.context);
    const vault = await client.getVault(req.vault);
    if (vault.frozen) {
      return this.refused(
        'frozen',
        null,
        amount,
        ['payments are frozen'],
        null,
        "Payments are paused right now while your guardians check on something. Your money is safe. I'd suggest calling one of them.",
      );
    }

    const resolution = await this.resolvePayee(vault, req.payeeName);
    if ('options' in resolution) {
      return {
        outcome: 'clarify',
        options: resolution.options,
        amount,
        message: `Did you mean ${resolution.options.slice(0, -1).join(', ')} or ${resolution.options.at(-1)}?`,
      };
    }
    const payee = resolution;

    const callRisk = this.deps.calls.riskFor(vault.address);
    const saidRisk = mergeScores(await said, req.agentConcern ?? NO_SCAM);
    const scam = maxScore(callRisk, saidRisk);
    const risk = scoreRisk({
      newPayee: !payee.active,
      amount,
      weeklyCap: vault.weeklyCap,
      scamCue: scam.risk,
      recentRequests,
    });

    if (risk.total >= this.opts.refuseThreshold) {
      const froze = scam.risk >= this.opts.refuseThreshold && (await this.sentinelFreeze(vault.address));
      const reasons = scam.reasons.length ? scam.reasons : ['this payment looks very unusual'];
      await this.deps.alerts.paymentRefused(vault.address, payee.name, amount, reasons, froze);
      return this.refused(
        'scam_suspected',
        payee,
        amount,
        reasons,
        risk,
        "This sounds like a common scam, so I'm not sending it. I've let your guardians know. Nobody legitimate will ever ask you to pay this way or keep it a secret.",
      );
    }

    if (amount > vault.balance) {
      return this.refused(
        'insufficient_funds',
        payee,
        amount,
        ['not enough in the spending balance'],
        risk,
        `You don't have enough in your spending balance for that. You have ${spokenUsd(vault.balance)}.`,
      );
    }

    const reasons = this.hardRuleFailures(vault, payee, amount);
    if (reasons.length === 0 && risk.total < this.opts.holdThreshold) {
      try {
        const { signature } = await client.pay(vault.address, payee.recipient, amount);
        return {
          outcome: 'paid',
          payee,
          amount,
          signature,
          risk,
          message: `Done. I sent ${payee.name} ${spokenUsd(amount)}.`,
        };
      } catch (err) {
        if (!isVaultError(err)) throw err;
        reasons.push(err.message.toLowerCase());
      }
    }
    // Every hard rule passed, so the risk score is what held it: say which part, not "over your limit".
    let cause: HoldCause = 'rules';
    if (reasons.length === 0) {
      if (callRisk.risk > 0) {
        cause = 'recent_call';
        reasons.push('a suspicious call to her in the last few minutes');
      } else if (saidRisk.risk > 0) {
        cause = 'scam_cue';
        reasons.push(...saidRisk.reasons);
      } else {
        cause = 'unusual';
        reasons.push('this payment looks unusual');
      }
    }

    try {
      const { signature, hold } = await client.requestHold(vault.address, payee.recipient, amount);
      return { outcome: 'held', payee, amount, hold, signature, reasons, risk, message: this.heldMessage(vault, payee, hold, cause) };
    } catch (err) {
      if (isVaultError(err, 'TooManyHolds')) {
        return this.refused(
          'too_many_holds',
          payee,
          amount,
          [err.message],
          risk,
          "You already have several payments waiting for approval, so I can't add another one yet. Your guardians can clear them.",
        );
      }
      throw err;
    }
  }

  private async scoreSaid(context: string | undefined): Promise<ScamScore> {
    const text = context?.trim();
    if (!text) return NO_SCAM;
    const keywords = scoreText(text);
    const llm = this.deps.scamScorer;
    return llm ? mergeScores(keywords, await llm.score(text, 'payment_request')) : keywords;
  }

  private async resolvePayee(vault: VaultState, spoken: string): Promise<ResolvedPayee | { options: string[] }> {
    const { best, ambiguous } = this.deps.directory.match(vault.address, spoken);
    if (ambiguous.length > 1) return { options: ambiguous.map((e) => e.name) };
    const entry = best ?? this.deps.directory.createClaim(vault.address, spoken);
    const payees = await this.deps.client.listPayees(vault.address);
    const p = payees.find((x) => x.recipient === entry.recipient);
    return {
      recipient: entry.recipient,
      name: entry.name,
      allowlisted: p !== undefined,
      active: p !== undefined && isPayeeActive(p, this.deps.now()),
    };
  }

  private hardRuleFailures(vault: VaultState, payee: ResolvedPayee, amount: Units): string[] {
    const reasons: string[] = [];
    if (!payee.allowlisted) reasons.push(`${payee.name} is not a saved payee`);
    else if (!payee.active) reasons.push(`${payee.name} was added recently and is still in the waiting period`);
    if (amount > vault.perPaymentLimit) reasons.push('over the per-payment limit');
    if (amount > weeklyRemaining(vault, this.deps.now())) reasons.push('over the weekly limit');
    return reasons;
  }

  private heldMessage(vault: VaultState, payee: ResolvedPayee, hold: Hold, cause: HoldCause): string {
    const names = vault.guardians.map((g) => this.deps.directory.label(g)).filter((n): n is string => !!n);
    const who =
      hold.approvalsRequired === 2
        ? 'two of your guardians'
        : names.length === 1
          ? names[0]
          : names.length > 1
            ? `${names[0]} and your other guardians`
            : 'your guardian';
    const why =
      cause === 'recent_call'
        ? 'There was a suspicious call on your line a few minutes ago'
        : cause === 'scam_cue'
          ? 'Something about this sounds like a scam warning sign'
          : cause === 'unusual'
            ? 'This one looks a little unusual'
            : payee.active
              ? "That's more than your usual limit"
              : payee.allowlisted
                ? `${payee.name} was only added recently`
                : `I don't know ${payee.name} yet`;
    return `${why}, so I've put ${spokenUsd(hold.amount)} on hold and asked ${who} to approve it. Your money is safe in the meantime, and if nobody approves it, it comes back to your balance.`;
  }

  private async sentinelFreeze(vault: Pubkey): Promise<boolean> {
    try {
      await this.deps.client.freeze(vault, { kind: 'sentinel' });
      return true;
    } catch (err) {
      if (isVaultError(err, 'AlreadyFrozen')) return true;
      throw err;
    }
  }

  private recordRequest(vault: Pubkey): number {
    const now = this.deps.now();
    const cutoff = now - this.opts.velocityWindowSeconds;
    const times = (this.requests.get(vault) ?? []).filter((t) => t > cutoff);
    times.push(now);
    this.requests.set(vault, times);
    return times.length;
  }

  private refused(
    code: RefusalCode,
    payee: ResolvedPayee | null,
    amount: Units,
    reasons: string[],
    risk: RiskBreakdown | null,
    message: string,
  ): PaymentDecision {
    return { outcome: 'refused', code, payee, amount, reasons, risk, message };
  }
}
