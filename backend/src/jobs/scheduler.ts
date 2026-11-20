import type { Clock, Pubkey, UnixSeconds } from '../domain/types.js';
import type { EventBus } from '../events/bus.js';
import type { VaultEvent } from '../events/types.js';
import type { Logger } from '../logger.js';
import type { VaultClient } from '../vault/client.js';
import { isVaultError } from '../vault/errors.js';

/**
 * Calls the permissionless instructions when their time comes: `expire` on overdue holds and
 * `execute_unfreeze` once a senior's waiting period ends. Driven by vault events (from a chain
 * indexer in production), so it needs no polling of chain state.
 */
export class DeadlineScheduler {
  private readonly holds = new Map<Pubkey, { vault: Pubkey; due: UnixSeconds }>();
  private readonly unfreezes = new Map<Pubkey, UnixSeconds>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly client: VaultClient,
    private readonly now: Clock,
    private readonly log: Logger,
  ) {}

  attach(bus: EventBus): void {
    bus.subscribe((e) => this.onEvent(e));
  }

  onEvent(e: VaultEvent): void {
    const hold = typeof e.data.hold === 'string' ? e.data.hold : null;
    switch (e.kind) {
      case 'HoldCreated':
        if (hold) this.holds.set(hold, { vault: e.vault, due: Number(e.data.expiresAt) });
        break;
      case 'HoldReleased':
      case 'HoldRejected':
      case 'HoldExpired':
        if (hold) this.holds.delete(hold);
        break;
      case 'UnfreezeRequested':
        this.unfreezes.set(e.vault, Number(e.data.effectiveAt));
        break;
      case 'VaultUnfrozen':
      case 'VaultFrozen':
        this.unfreezes.delete(e.vault);
        break;
      default:
        break;
    }
  }

  pending(): { holds: number; unfreezes: number } {
    return { holds: this.holds.size, unfreezes: this.unfreezes.size };
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      for (const [hold, { vault, due }] of [...this.holds]) {
        if (now < due) continue;
        try {
          await this.client.expire(vault, hold);
        } catch (err) {
          if (isVaultError(err, 'HoldNotFound')) this.holds.delete(hold);
          else this.log.warn({ err, hold }, 'expire failed; will retry');
        }
      }
      for (const [vault, due] of [...this.unfreezes]) {
        if (now < due) continue;
        try {
          await this.client.executeUnfreeze(vault);
        } catch (err) {
          if (isVaultError(err, 'NotFrozen') || isVaultError(err, 'NoUnfreezeRequested')) this.unfreezes.delete(vault);
          else this.log.warn({ err, vault }, 'execute_unfreeze failed; will retry');
        }
      }
    } finally {
      this.running = false;
    }
  }

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
