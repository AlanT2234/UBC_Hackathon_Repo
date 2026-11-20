import type { Logger } from '../logger.js';
import type { VaultEvent } from './types.js';

type Listener = (e: VaultEvent) => void | Promise<void>;

/**
 * Single fan-out point for vault events, whether they come from the mock client or from the
 * optional chain-event webhook. Dedupes redeliveries and keeps a bounded history for the dashboard.
 */
export class EventBus {
  private readonly listeners = new Set<Listener>();
  private readonly log: VaultEvent[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly capacity = 1000,
  ) {}

  /** Returns false if this event was already published (an indexer webhook may redeliver). */
  publish(e: VaultEvent): boolean {
    const id = `${e.signature}:${e.kind}:${e.data.hold ?? ''}`;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.log.push(e);
    if (this.log.length > this.capacity) this.log.shift();
    if (this.seen.size > this.capacity * 4) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    for (const fn of this.listeners) {
      try {
        const r = fn(e);
        if (r instanceof Promise) r.catch((err) => this.logger.error({ err, kind: e.kind }, 'event listener failed'));
      } catch (err) {
        this.logger.error({ err, kind: e.kind }, 'event listener failed');
      }
    }
    return true;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  history(vault?: string): VaultEvent[] {
    return vault ? this.log.filter((e) => e.vault === vault) : [...this.log];
  }
}
