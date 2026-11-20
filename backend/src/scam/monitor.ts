import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Clock, Pubkey, UnixSeconds } from '../domain/types.js';
import type { Logger } from '../logger.js';
import type { AlertService } from '../alerts/service.js';
import type { VaultClient } from '../vault/client.js';
import { isVaultError } from '../vault/errors.js';
import type { ScamScorer } from './llm.js';
import { NO_SCAM, maxScore, mergeScores, scoreText, type ScamScore } from './rules.js';

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
 * moment the transcript looks like a scam: keyword rules on every chunk, then an LLM pass in the
 * background. Emits `update` with the session for the live dashboard.
 */
export class CallMonitor extends EventEmitter<{ update: [CallSession] }> {
  private readonly sessions = new Map<string, CallSession>();
  /** One LLM pass in flight per call; chunks that arrive meanwhile are folded into the next pass. */
  private readonly llmRuns = new Map<string, Promise<void>>();
  private readonly llmStale = new Set<string>();

  constructor(
    private readonly client: VaultClient,
    private readonly alerts: AlertService,
    private readonly now: Clock,
    private readonly log: Logger,
    private readonly opts: CallMonitorOptions = DEFAULT_CALL_OPTIONS,
    private readonly llm?: ScamScorer,
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
    session.score = maxScore(session.score, scoreText(this.window(session)));
    await this.freezeIfScam(session);
    this.emit('update', session);
    this.scheduleLlm(session);
    return session;
  }

  /** Resolves once every LLM pass in flight has finished (tests, graceful shutdown). */
  async settled(): Promise<void> {
    while (this.llmRuns.size > 0) await Promise.all(this.llmRuns.values());
  }

  private window(session: CallSession): string {
    return session.transcript.map((t) => t.text).join(' ').slice(-this.opts.windowChars);
  }

  /** Layer 2: the keyword pass already ran (and may have frozen); the LLM can only raise the score. */
  private scheduleLlm(session: CallSession): void {
    const llm = this.llm;
    if (!llm) return;
    if (this.llmRuns.has(session.id)) {
      this.llmStale.add(session.id);
      return;
    }
    const run = (async () => {
      do {
        this.llmStale.delete(session.id);
        const score = await llm.score(this.window(session), 'call');
        if (score.risk <= session.score.risk) continue;
        session.score = mergeScores(session.score, score);
        await this.freezeIfScam(session);
        this.emit('update', session);
      } while (this.llmStale.has(session.id));
    })()
      .catch((err) => this.log.error({ err, call: session.id }, 'scam LLM pass failed'))
      .finally(() => this.llmRuns.delete(session.id));
    this.llmRuns.set(session.id, run);
  }

  private async freezeIfScam(session: CallSession): Promise<void> {
    const id = session.id;
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
