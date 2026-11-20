import type { Pubkey, UnixSeconds, Units } from '../domain/types.js';
import type { EventBus } from '../events/bus.js';
import type { VaultEvent } from '../events/types.js';
import { formatUsd } from '../money.js';
import type { PayeeDirectory } from '../payees/directory.js';
import type { CallSession } from '../scam/monitor.js';
import type { Notifier } from './notifier.js';

export interface AlertOptions {
  dashboardUrl: string;
  timeZone: string;
}

/** Turns vault events and offchain decisions into guardian alerts. */
export class AlertService {
  constructor(
    private readonly notifier: Notifier,
    private readonly directory: PayeeDirectory,
    private readonly opts: AlertOptions,
  ) {}

  attach(bus: EventBus): void {
    bus.subscribe((e) => {
      const text = this.describe(e);
      return text ? this.notifier.send(text) : undefined;
    });
  }

  async paymentRefused(vault: Pubkey, payee: string, amount: Units, reasons: string[], froze: boolean): Promise<void> {
    const lines = [
      `🛑 SafeNSound refused a payment: ${this.owner(vault)} asked to send ${payee} ${formatUsd(amount)}.`,
      ...reasons.map((r) => `• ${r}`),
      froze ? `Payments are now frozen. Please call ${this.owner(vault)}.` : `Please give ${this.owner(vault)} a call.`,
      this.link(vault),
    ];
    await this.notifier.send(lines.join('\n'));
  }

  async scamCallDetected(call: CallSession): Promise<void> {
    const lines = [
      `🚨 Possible scam call to ${this.owner(call.vault)}${call.caller ? ` from ${call.caller}` : ''}.`,
      `Type: ${call.score.scamType ?? 'unknown'} · risk ${Math.round(call.score.risk * 100)}%`,
      ...call.score.reasons.map((r) => `• ${r}`),
      `Payments are frozen. Call ${this.owner(call.vault)} now.`,
      this.link(call.vault),
    ];
    await this.notifier.send(lines.join('\n'));
  }

  describe(e: VaultEvent): string | null {
    const owner = this.owner(e.vault);
    const d = e.data;
    const payee = typeof d.recipient === 'string' ? this.name(d.recipient) : 'someone';
    const amount = typeof d.amount === 'string' ? formatUsd(BigInt(d.amount)) : '';
    switch (e.kind) {
      case 'HoldCreated': {
        const needs = d.approvalsRequired === 2 ? '2 guardian approvals' : '1 guardian approval';
        return [
          `🔔 ${owner} wants to pay ${payee} ${amount}.`,
          `It's held safely until ${this.time(Number(d.expiresAt))} and needs ${needs}. If nobody approves, the money goes back to ${owner}'s balance.`,
          this.link(e.vault),
        ].join('\n');
      }
      case 'HoldApproved':
        return `👍 ${this.name(String(d.guardian))} approved a held payment (${d.approvals} of ${d.approvalsRequired}).`;
      case 'HoldReleased':
        return `✅ Payment of ${amount} to ${payee} was approved by ${this.name(String(d.guardian))} and sent.`;
      case 'HoldRejected':
        return `↩️ Payment of ${amount} to ${payee} was rejected by ${this.name(String(d.by))}. The money is back in ${owner}'s balance.`;
      case 'HoldExpired':
        return `⌛ Nobody approved ${amount} to ${payee} in time. The money is back in ${owner}'s balance.`;
      case 'VaultFrozen':
        // Sentinel freezes are announced by scamCallDetected / paymentRefused with more context.
        return d.by === 'sentinel' ? null : `🧊 ${this.name(String(d.by))} froze ${owner}'s payments.`;
      case 'FreezeVoteRecorded':
        return `🗳️ ${this.name(String(d.guardian))} voted to refreeze ${owner}'s payments (${d.votes} of ${d.required} needed).`;
      case 'UnfreezeRequested':
        return [
          `⚠️ ${owner} asked to unfreeze payments. It takes effect ${this.time(Number(d.effectiveAt))}.`,
          `If someone may be pressuring ${owner}, call now. A guardian can also unfreeze sooner.`,
          this.link(e.vault),
        ].join('\n');
      case 'VaultUnfrozen':
        return d.by === 'senior_delay'
          ? `🔓 ${owner}'s payments are live again after the self-unfreeze waiting period.`
          : `🔓 ${this.name(String(d.by))} unfroze ${owner}'s payments.`;
      case 'PayeeProposed':
        return `➕ ${this.name(String(d.proposedBy))} added ${payee} as a payee. Usable from ${this.time(Number(d.activeAt))}.`;
      case 'PaymentSent':
      case 'VaultFunded':
        return null; // everyday activity: shown on the dashboard, not pushed
    }
  }

  private owner(vault: Pubkey): string {
    return this.directory.label(vault) ?? 'Your family member';
  }

  private name(key: Pubkey): string {
    return this.directory.label(key) ?? `${key.slice(0, 4)}…${key.slice(-4)}`;
  }

  private time(at: UnixSeconds): string {
    return new Date(at * 1000).toLocaleString('en-US', {
      timeZone: this.opts.timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private link(vault: Pubkey): string {
    return `${this.opts.dashboardUrl}/vaults/${vault}`;
  }
}
