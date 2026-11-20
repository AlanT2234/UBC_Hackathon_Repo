import { EventEmitter } from 'node:events';
import type { Clock, Pubkey, UnixSeconds, Units } from '../domain/types.js';
import type { EventBus } from '../events/bus.js';
import type { VaultEvent } from '../events/types.js';
import type { PayeeDirectory } from '../payees/directory.js';
import type { PaymentDecision, PaymentRequest } from '../policy/engine.js';

export type PaymentStatus = 'paid' | 'held' | 'refused' | 'declined' | 'expired';

/** One payment request as the dashboard shows it, from first ask to final outcome. */
export interface PaymentRecord {
  /** Hold address for held payments, tx signature for instant ones, a local id for refusals. */
  id: string;
  vault: Pubkey;
  payee: string;
  recipient: Pubkey | null;
  amount: Units;
  /** What the senior said about the payment, when it came through the policy engine. */
  memo: string | null;
  status: PaymentStatus;
  reasons: string[];
  requestedAt: UnixSeconds;
  decidedAt: UnixSeconds | null;
  hold: Pubkey | null;
  /** Latest transaction for this payment (the release, for a held one). */
  signature: string | null;
  approvals: Pubkey[];
  approvalsRequired: number;
  expiresAt: UnixSeconds | null;
}

/**
 * Payment history for the dashboard. Onchain facts come from the event bus, so payments made
 * outside the policy engine (force-pay, other clients) still show up; the engine adds what the
 * chain doesn't know: the memo, the reasons, and refusals that never became a transaction.
 */
export class PaymentLog extends EventEmitter<{ update: [PaymentRecord] }> {
  private readonly records = new Map<string, PaymentRecord>();
  private refusals = 0;

  constructor(
    private readonly directory: PayeeDirectory,
    private readonly now: Clock,
    private readonly capacity = 500,
  ) {
    super();
  }

  attach(bus: EventBus): () => void {
    return bus.subscribe((e) => this.onEvent(e));
  }

  list(vault: Pubkey): PaymentRecord[] {
    // Reverse insertion order first so the stable sort keeps same-second requests newest first.
    return [...this.records.values()]
      .filter((r) => r.vault === vault)
      .reverse()
      .sort((a, b) => b.requestedAt - a.requestedAt);
  }

  get(id: string): PaymentRecord | undefined {
    return this.records.get(id);
  }

  noteDecision(req: PaymentRequest, d: PaymentDecision): void {
    if (d.outcome === 'clarify') return;
    const memo = req.context?.trim() || null;
    if (d.outcome === 'refused') {
      this.refusals += 1;
      this.upsert(`refused_${this.now()}_${this.refusals}`, {
        vault: req.vault,
        payee: d.payee?.name ?? req.payeeName,
        recipient: d.payee?.recipient ?? null,
        amount: d.amount,
        memo,
        status: 'refused',
        reasons: d.reasons,
        decidedAt: this.now(),
      });
      return;
    }
    const common = { vault: req.vault, payee: d.payee.name, recipient: d.payee.recipient, amount: d.amount, memo };
    if (d.outcome === 'paid') {
      const decidedAt = this.records.get(d.signature)?.decidedAt ?? this.now();
      this.upsert(d.signature, { ...common, status: 'paid', signature: d.signature, decidedAt });
      return;
    }
    const { hold } = d;
    this.upsert(hold.address, {
      ...common,
      reasons: d.reasons,
      hold: hold.address,
      approvalsRequired: hold.approvalsRequired,
      expiresAt: hold.expiresAt,
    });
  }

  private onEvent(e: VaultEvent): void {
    const hold = typeof e.data.hold === 'string' ? e.data.hold : null;
    const recipient = typeof e.data.recipient === 'string' ? e.data.recipient : null;
    const amount = typeof e.data.amount === 'string' ? BigInt(e.data.amount) : 0n;
    // Undefined fields are skipped on merge, so a missing label never overwrites the engine's name.
    const base = { vault: e.vault, recipient, payee: (recipient && this.directory.label(recipient)) || undefined, amount };
    switch (e.kind) {
      case 'PaymentSent':
        return this.upsert(e.signature, { ...base, status: 'paid', signature: e.signature, decidedAt: e.at }, e.at);
      case 'HoldCreated':
        if (!hold) return;
        return this.upsert(
          hold,
          {
            ...base,
            status: 'held',
            hold,
            signature: e.signature,
            approvalsRequired: Number(e.data.approvalsRequired ?? 1),
            expiresAt: typeof e.data.expiresAt === 'number' ? e.data.expiresAt : null,
          },
          e.at,
        );
      case 'HoldApproved':
        return this.approved(hold, e.data.guardian);
      case 'HoldReleased':
        this.approved(hold, e.data.guardian);
        return this.settle(hold, 'paid', e);
      case 'HoldRejected':
        return this.settle(hold, 'declined', e);
      case 'HoldExpired':
        return this.settle(hold, 'expired', e);
    }
  }

  private approved(hold: string | null, guardian: unknown): void {
    const r = hold ? this.records.get(hold) : undefined;
    if (!r || typeof guardian !== 'string' || r.approvals.includes(guardian)) return;
    this.upsert(r.id, { approvals: [...r.approvals, guardian] });
  }

  private settle(hold: string | null, status: PaymentStatus, e: VaultEvent): void {
    if (!hold || !this.records.has(hold)) return;
    this.upsert(hold, { status, decidedAt: e.at, signature: e.signature });
  }

  /** Creates or merges, so engine notes and bus events can arrive in either order. */
  private upsert(id: string, patch: Partial<PaymentRecord>, requestedAt: UnixSeconds = this.now()): void {
    const existing = this.records.get(id);
    const merged: PaymentRecord = existing
      ? { ...existing, ...definedOnly(patch) }
      : {
          id,
          vault: '',
          payee: 'Someone new',
          recipient: null,
          amount: 0n,
          memo: null,
          status: 'held',
          reasons: [],
          requestedAt,
          decidedAt: null,
          hold: null,
          signature: null,
          approvals: [],
          approvalsRequired: 0,
          expiresAt: null,
          ...definedOnly(patch),
        };
    this.records.set(id, merged);
    if (!existing && this.records.size > this.capacity) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
    this.emit('update', merged);
  }
}

function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}
