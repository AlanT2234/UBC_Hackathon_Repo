import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import {
  MAX_OPEN_HOLDS,
  approvalsRequiredFor,
  isPayeeActive,
  isProfessional,
  popcount,
  refreezeQuorum,
  spentThisWindow,
  windowExpired,
} from '../domain/rules.js';
import type { Clock, Hold, Payee, Pubkey, Units, VaultState } from '../domain/types.js';
import type { EventBus } from '../events/bus.js';
import type { EventValue, VaultEventKind } from '../events/types.js';
import type { FreezeAuthority, TxResult, VaultClient } from './client.js';
import { VaultError } from './errors.js';

interface VaultRecord {
  state: VaultState;
  payees: Map<Pubkey, Payee>;
  holds: Map<Pubkey, Hold>;
}

export interface CreateVaultParams {
  address?: Pubkey;
  senior: Pubkey;
  mint?: Pubkey;
  guardians: Pubkey[];
  professionalMask?: number;
  bigAmountThreshold: Units;
  perPaymentLimit: Units;
  weeklyCap: Units;
  holdSeconds: number;
  unfreezeDelaySeconds: number;
  changeDelaySeconds: number;
  agentSessionKey?: Pubkey;
  balance?: Units;
}

/** Signatures are prefixed so nobody mistakes them for devnet transactions. */
export const MOCK_SIGNATURE_PREFIX = 'mock-';

const mockSignature = () => MOCK_SIGNATURE_PREFIX + randomBytes(16).toString('hex');
const mockAddress = () => Keypair.generate().publicKey.toBase58();

/**
 * In-memory stand-in for `safespend_vault`. Each method checks every precondition before mutating
 * anything, so a thrown `VaultError` leaves state untouched (like a reverted transaction).
 */
export class MockVaultClient implements VaultClient {
  private readonly vaults = new Map<Pubkey, VaultRecord>();

  constructor(
    private readonly bus: EventBus,
    private readonly now: Clock,
  ) {}

  createVault(p: CreateVaultParams): VaultState {
    if (p.guardians.length > 3) throw new RangeError('At most 3 guardians');
    const state: VaultState = {
      address: p.address ?? mockAddress(),
      senior: p.senior,
      mint: p.mint ?? mockAddress(),
      guardians: [...p.guardians],
      professionalMask: p.professionalMask ?? 0,
      bigAmountThreshold: p.bigAmountThreshold,
      perPaymentLimit: p.perPaymentLimit,
      weeklyCap: p.weeklyCap,
      windowStart: this.now(),
      spentInWindow: 0n,
      holdSeconds: p.holdSeconds,
      unfreezeDelaySeconds: p.unfreezeDelaySeconds,
      changeDelaySeconds: p.changeDelaySeconds,
      frozen: false,
      unfreezeRequestedAt: null,
      selfUnfrozenAt: null,
      freezeVotes: 0,
      agentSessionKey: p.agentSessionKey ?? mockAddress(),
      nextNonce: 0n,
      openHolds: 0,
      balance: p.balance ?? 0n,
    };
    this.vaults.set(state.address, { state, payees: new Map(), holds: new Map() });
    return structuredClone(state);
  }

  /** Setup helper: adds an allowlist entry that is active immediately (as if set at `init_vault`). */
  seedPayee(vault: Pubkey, recipient: Pubkey): Payee {
    const payee = { vault, recipient, activeAt: this.now() };
    this.record(vault).payees.set(recipient, payee);
    return { ...payee };
  }

  /** Guardian top-up (stands in for the on-ramp). */
  async fund(vault: Pubkey, amount: Units): Promise<TxResult> {
    const v = this.record(vault).state;
    if (amount <= 0n) throw new VaultError('InvalidAmount');
    v.balance += amount;
    return { signature: this.emit('VaultFunded', vault, { amount: amount.toString(), balance: v.balance.toString() }) };
  }

  vaultAddresses(): Pubkey[] {
    return [...this.vaults.keys()];
  }

  async getVault(vault: Pubkey): Promise<VaultState> {
    return structuredClone(this.record(vault).state);
  }

  async listPayees(vault: Pubkey): Promise<Payee[]> {
    return [...this.record(vault).payees.values()].map((p) => ({ ...p }));
  }

  async listHolds(vault: Pubkey): Promise<Hold[]> {
    return [...this.record(vault).holds.values()].map((h) => structuredClone(h));
  }

  async addPayee(vault: Pubkey, signer: Pubkey, recipient: Pubkey): Promise<TxResult & { payee: Payee }> {
    const r = this.record(vault);
    const v = r.state;
    if (signer !== v.senior && !v.guardians.includes(signer)) throw new VaultError('Unauthorized');
    if (r.payees.has(recipient)) throw new VaultError('PayeeExists');
    const payee = { vault, recipient, activeAt: this.now() + v.changeDelaySeconds };
    r.payees.set(recipient, payee);
    const signature = this.emit('PayeeProposed', vault, { recipient, proposedBy: signer, activeAt: payee.activeAt });
    return { signature, payee: { ...payee } };
  }
  async removePayee(vault: Pubkey, signer: Pubkey, recipient: Pubkey): Promise<TxResult> {
    const r = this.record(vault);
    const v = r.state;
    if (signer !== v.senior && !v.guardians.includes(signer)) throw new VaultError('Unauthorized');
    if (!r.payees.delete(recipient)) throw new VaultError('PayeeNotFound');
    return { signature: this.emit('PayeeRemoved', vault, { recipient, removedBy: signer }) };
  }


  async pay(vault: Pubkey, recipient: Pubkey, amount: Units): Promise<TxResult> {
    const r = this.record(vault);
    const v = r.state;
    const now = this.now();
    if (v.frozen) throw new VaultError('Frozen');
    if (amount <= 0n) throw new VaultError('InvalidAmount');
    const payee = r.payees.get(recipient);
    if (!payee || !isPayeeActive(payee, now)) throw new VaultError('PayeeNotAllowlisted');
    if (amount > v.perPaymentLimit) throw new VaultError('OverPerPaymentLimit');
    const spent = spentThisWindow(v, now);
    if (spent + amount > v.weeklyCap) throw new VaultError('OverWeeklyCap');
    if (amount > v.balance) throw new VaultError('InsufficientFunds');

    if (windowExpired(v, now)) v.windowStart = now;
    v.spentInWindow = spent + amount;
    v.balance -= amount;
    return {
      signature: this.emit('PaymentSent', vault, {
        recipient,
        amount: amount.toString(),
        spentInWindow: v.spentInWindow.toString(),
      }),
    };
  }

  async requestHold(vault: Pubkey, recipient: Pubkey, amount: Units): Promise<TxResult & { hold: Hold }> {
    const r = this.record(vault);
    const v = r.state;
    const now = this.now();
    if (v.frozen) throw new VaultError('Frozen');
    if (amount <= 0n) throw new VaultError('InvalidAmount');
    if (v.openHolds >= MAX_OPEN_HOLDS) throw new VaultError('TooManyHolds');
    if (amount > v.balance) throw new VaultError('InsufficientFunds');

    const hold: Hold = {
      address: mockAddress(),
      vault,
      recipient,
      amount,
      nonce: v.nextNonce,
      createdAt: now,
      expiresAt: now + v.holdSeconds,
      approvalsRequired: approvalsRequiredFor(v, amount),
      approvals: [],
    };
    v.balance -= amount;
    v.nextNonce += 1n;
    v.openHolds += 1;
    r.holds.set(hold.address, hold);
    const signature = this.emit('HoldCreated', vault, {
      hold: hold.address,
      recipient,
      amount: amount.toString(),
      nonce: hold.nonce.toString(),
      expiresAt: hold.expiresAt,
      approvalsRequired: hold.approvalsRequired,
    });
    return { signature, hold: structuredClone(hold) };
  }

  async approve(vault: Pubkey, holdAddr: Pubkey, guardian: Pubkey): Promise<TxResult & { released: boolean }> {
    const r = this.record(vault);
    const v = r.state;
    if (v.frozen) throw new VaultError('Frozen');
    const hold = this.hold(r, holdAddr);
    if (this.now() >= hold.expiresAt) throw new VaultError('HoldExpired');
    if (!v.guardians.includes(guardian)) throw new VaultError('NotGuardian');
    if (hold.approvals.includes(guardian)) throw new VaultError('AlreadyApproved');

    hold.approvals.push(guardian);
    if (hold.approvals.length >= hold.approvalsRequired) {
      this.closeHold(r, hold);
      const signature = this.emit('HoldReleased', vault, {
        hold: hold.address,
        recipient: hold.recipient,
        amount: hold.amount.toString(),
        guardian,
      });
      return { signature, released: true };
    }
    const signature = this.emit('HoldApproved', vault, {
      hold: hold.address,
      guardian,
      approvals: hold.approvals.length,
      approvalsRequired: hold.approvalsRequired,
    });
    return { signature, released: false };
  }

  async reject(vault: Pubkey, holdAddr: Pubkey, signer: Pubkey): Promise<TxResult> {
    const r = this.record(vault);
    const hold = this.hold(r, holdAddr);
    if (signer !== r.state.senior && !r.state.guardians.includes(signer)) throw new VaultError('Unauthorized');
    this.refund(r, hold);
    return {
      signature: this.emit('HoldRejected', vault, {
        hold: hold.address,
        recipient: hold.recipient,
        amount: hold.amount.toString(),
        by: signer,
      }),
    };
  }

  async expire(vault: Pubkey, holdAddr: Pubkey): Promise<TxResult> {
    const r = this.record(vault);
    const hold = this.hold(r, holdAddr);
    if (this.now() < hold.expiresAt) throw new VaultError('HoldNotExpired');
    this.refund(r, hold);
    return {
      signature: this.emit('HoldExpired', vault, {
        hold: hold.address,
        recipient: hold.recipient,
        amount: hold.amount.toString(),
      }),
    };
  }

  async freeze(vault: Pubkey, by: FreezeAuthority): Promise<TxResult & { frozen: boolean }> {
    const v = this.record(vault).state;
    if (v.frozen) throw new VaultError('AlreadyFrozen');
    if (by.kind === 'guardian') {
      const idx = v.guardians.indexOf(by.key);
      if (idx < 0) throw new VaultError('NotGuardian');
      // After a senior self-unfreeze, one family guardian alone cannot lock her out again.
      if (v.selfUnfrozenAt !== null && !isProfessional(v, idx)) {
        const votes = popcount(v.freezeVotes | (1 << idx));
        const required = refreezeQuorum(v);
        if (votes < required) {
          v.freezeVotes |= 1 << idx;
          const signature = this.emit('FreezeVoteRecorded', vault, { guardian: by.key, votes, required });
          return { signature, frozen: false };
        }
      }
    }
    v.frozen = true;
    v.freezeVotes = 0;
    v.unfreezeRequestedAt = null;
    const signature = this.emit('VaultFrozen', vault, { by: by.kind === 'guardian' ? by.key : 'sentinel' });
    return { signature, frozen: true };
  }

  async unfreeze(vault: Pubkey, guardian: Pubkey): Promise<TxResult> {
    const v = this.record(vault).state;
    if (!v.frozen) throw new VaultError('NotFrozen');
    if (!v.guardians.includes(guardian)) throw new VaultError('NotGuardian');
    v.frozen = false;
    v.unfreezeRequestedAt = null;
    v.selfUnfrozenAt = null;
    return { signature: this.emit('VaultUnfrozen', vault, { by: guardian }) };
  }

  async requestUnfreeze(vault: Pubkey, senior: Pubkey): Promise<TxResult> {
    const v = this.record(vault).state;
    if (!v.frozen) throw new VaultError('NotFrozen');
    if (senior !== v.senior) throw new VaultError('Unauthorized');
    if (v.unfreezeRequestedAt !== null) throw new VaultError('UnfreezeAlreadyRequested');
    const now = this.now();
    v.unfreezeRequestedAt = now;
    return {
      signature: this.emit('UnfreezeRequested', vault, {
        requestedAt: now,
        effectiveAt: now + v.unfreezeDelaySeconds,
      }),
    };
  }

  async executeUnfreeze(vault: Pubkey): Promise<TxResult> {
    const v = this.record(vault).state;
    if (!v.frozen) throw new VaultError('NotFrozen');
    if (v.unfreezeRequestedAt === null) throw new VaultError('NoUnfreezeRequested');
    const now = this.now();
    if (now < v.unfreezeRequestedAt + v.unfreezeDelaySeconds) throw new VaultError('UnfreezeDelayNotElapsed');
    v.frozen = false;
    v.unfreezeRequestedAt = null;
    v.selfUnfrozenAt = now;
    v.freezeVotes = 0;
    return { signature: this.emit('VaultUnfrozen', vault, { by: 'senior_delay' }) };
  }

  private record(vault: Pubkey): VaultRecord {
    const r = this.vaults.get(vault);
    if (!r) throw new VaultError('VaultNotFound', vault);
    return r;
  }

  private hold(r: VaultRecord, address: Pubkey): Hold {
    const h = r.holds.get(address);
    if (!h) throw new VaultError('HoldNotFound', address);
    return h;
  }

  private closeHold(r: VaultRecord, hold: Hold): void {
    r.holds.delete(hold.address);
    r.state.openHolds -= 1;
  }

  private refund(r: VaultRecord, hold: Hold): void {
    this.closeHold(r, hold);
    r.state.balance += hold.amount;
  }

  private emit(kind: VaultEventKind, vault: Pubkey, data: Record<string, EventValue>): string {
    const signature = mockSignature();
    this.bus.publish({ kind, vault, signature, at: this.now(), data });
    return signature;
  }
}
