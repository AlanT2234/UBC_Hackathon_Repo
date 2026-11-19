import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Clock, Pubkey, UnixSeconds } from '../domain/types.js';
import type { Logger } from '../logger.js';
import type { AlertService } from '../alerts/service.js';
import type { VaultClient } from '../vault/client.js';
import { isVaultError } from '../vault/errors.js';
import { NO_SCAM, maxScore, scoreText, type ScamScore } from './rules.js';

export interface CallSession {
  id: string;
  vault: Pubkey;
  caller: string | null;
  startedAt: UnixSeconds;
  lastActivity: UnixSeconds;
  endedAt: UnixSeconds | null;
  transcript: { at: UnixSeconds; text: string }[];
  /** Highest score seen this call; never decreases once a cue has been heard. */
  score: ScamScore;
  frozeVault: boolean;
}

export interface CallMonitorOptions {
  freezeThreshold: number;
  /** A call's risk still counts toward payment decisions this long after its last chunk. */
  activeSeconds: number;
  /** Rolling window scored on each chunk, so cues split across chunks still match. */
  windowChars: number;
}

export const DEFAULT_CALL_OPTIONS: CallMonitorOptions = { freezeThreshold: 0.6, activeSeconds: 15 * 60, windowChars: 3000 };

/**
 * Listens to unknown-number calls (Twilio → Scribe transcript chunks) and freezes the vault the
 * moment the transcript looks like a scam. Emits `update` with the session for the live dashboard.
 */
export class CallMonitor extends EventEmitter<{ update: [CallSession] }> {
  private readonly sessions = new Map<string, CallSession>();

  constructor(
    private readonly client: VaultClient,
    private readonly alerts: AlertService,
    private readonly now: Clock,
    private readonly log: Logger,
    private readonly opts: CallMonitorOptions = DEFAULT_CALL_OPTIONS,
  ) {
    super();
  }

  start(vault: Pubkey, caller: string | null = null, id: string = randomUUID()): CallSession {
    const now = this.now();
    const session: CallSession = {
      id,
      vault,
      caller,
      startedAt: now,
      lastActivity: now,
      endedAt: null,
      transcript: [],
      score: NO_SCAM,
      frozeVault: false,
    };
    this.sessions.set(id, session);
    this.emit('update', session);
    return session;
  }

  get(id: string): CallSession | undefined {
    return this.sessions.get(id);
  }

  list(vault: Pubkey): CallSession[] {
    return [...this.sessions.values()].filter((s) => s.vault === vault);
  }

  async ingest(id: string, text: string): Promise<CallSession> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown call ${id}`);
    const now = this.now();
    session.transcript.push({ at: now, text });
    session.lastActivity = now;
    const window = session.transcript.map((t) => t.text).join(' ').slice(-this.opts.windowChars);
    session.score = maxScore(session.score, scoreText(window));

    if (!session.frozeVault && session.score.risk >= this.opts.freezeThreshold) {
      session.frozeVault = true;
      try {
        await this.client.freeze(session.vault, { kind: 'sentinel' });
      } catch (err) {
        if (!isVaultError(err, 'AlreadyFrozen')) {
          session.frozeVault = false;
          this.log.error({ err, call: id }, 'scam freeze failed');
        }
      }
      if (session.frozeVault) await this.alerts.scamCallDetected(session);
    }
    this.emit('update', session);
    return session;
  }

  end(id: string): CallSession | undefined {
    const session = this.sessions.get(id);
    if (session && session.endedAt === null) {
      session.endedAt = this.now();
      this.emit('update', session);
    }
    return session;
  }

  /** Worst score among this vault's recent calls; feeds the payment risk score. */
  riskFor(vault: Pubkey): ScamScore {
    const cutoff = this.now() - this.opts.activeSeconds;
    let worst = NO_SCAM;
    for (const s of this.sessions.values()) {
      if (s.vault === vault && s.lastActivity >= cutoff) worst = maxScore(worst, s.score);
    }
    return worst;
  }
}
