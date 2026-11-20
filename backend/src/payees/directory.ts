import { Keypair } from '@solana/web3.js';
import type { Pubkey } from '../domain/types.js';

export type DirectoryKind = 'payee' | 'business' | 'claim';

/**
 * Offchain name book. The program only knows addresses; this maps spoken names to recipients.
 * `vault: null` entries (registered businesses) are visible to every vault.
 */
export interface DirectoryEntry {
  name: string;
  recipient: Pubkey;
  vault: Pubkey | null;
  aliases: string[];
  kind: DirectoryKind;
}

export interface MatchResult {
  best: DirectoryEntry | null;
  /** Set when two or more entries match equally well; the agent should ask which one. */
  ambiguous: DirectoryEntry[];
}

const STOPWORDS = new Set(['the', 'my', 'a', 'an', 'to', 'for', 'new', 'company', 'co', 'inc', 'llc', 'mr', 'mrs', 'ms']);

export function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

function matchScore(spoken: string[], candidate: string): number {
  const cand = nameTokens(candidate);
  if (cand.length === 0) return 0;
  if (cand.join(' ') === spoken.join(' ')) return 2;
  const shared = spoken.filter((t) => cand.includes(t)).length;
  return shared / Math.max(spoken.length, cand.length);
}

export class PayeeDirectory {
  private readonly entries = new Map<Pubkey, DirectoryEntry>();
  private readonly labels = new Map<Pubkey, string>();

  register(entry: DirectoryEntry): DirectoryEntry {
    this.entries.set(entry.recipient, entry);
    return entry;
  }

  /** Display name for a non-payee key (senior, guardian, vault). */
  setLabel(key: Pubkey, name: string): void {
    this.labels.set(key, name);
  }

  label(key: Pubkey): string | undefined {
    return this.labels.get(key) ?? this.entries.get(key)?.name;
  }

  unregister(recipient: Pubkey): void {
    this.entries.delete(recipient);
  }

  get(recipient: Pubkey): DirectoryEntry | undefined {
    return this.entries.get(recipient);
  }

  /** An entry whose name or a nickname is exactly `name` (ignoring case, punctuation, "the"...). */
  findExact(vault: Pubkey, name: string): DirectoryEntry | undefined {
    const wanted = nameTokens(name).join(' ');
    if (!wanted) return undefined;
    for (const entry of this.entries.values()) {
      if (entry.vault !== null && entry.vault !== vault) continue;
      if ([entry.name, ...entry.aliases].some((n) => nameTokens(n).join(' ') === wanted)) return entry;
    }
    return undefined;
  }

  match(vault: Pubkey, spokenName: string): MatchResult {
    const spoken = nameTokens(spokenName);
    if (spoken.length === 0) return { best: null, ambiguous: [] };
    const scored: { entry: DirectoryEntry; score: number }[] = [];
    for (const entry of this.entries.values()) {
      if (entry.vault !== null && entry.vault !== vault) continue;
      const score = Math.max(...[entry.name, ...entry.aliases].map((n) => matchScore(spoken, n)));
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) return { best: null, ambiguous: [] };
    const tied = scored.filter((s) => s.score === top.score).map((s) => s.entry);
    return tied.length > 1 ? { best: null, ambiguous: tied } : { best: top.entry, ambiguous: [] };
  }

  /**
   * Unknown name: mint a claim recipient so the payment can be held in escrow. In production the
   * payee claims it via a link (off-ramp); for the demo the key is server-held and discarded.
   */
  createClaim(vault: Pubkey, spokenName: string): DirectoryEntry {
    return this.register({
      name: spokenName.trim(),
      recipient: Keypair.generate().publicKey.toBase58(),
      vault,
      aliases: [],
      kind: 'claim',
    });
  }
}
