export const SCAM_TYPES = [
  'gift_card',
  'grandparent',
  'government_impersonation',
  'bank_impersonation',
  'credential_theft',
  'tech_support',
  'crypto_atm',
  'wire_transfer',
  'romance',
  'unknown',
] as const;

export type ScamType = (typeof SCAM_TYPES)[number];

export interface ScamScore {
  /** 0..1 */
  risk: number;
  scamType: ScamType | null;
  reasons: string[];
}

export const NO_SCAM: ScamScore = { risk: 0, scamType: null, reasons: [] };

interface ScamRule {
  pattern: RegExp;
  weight: number;
  /** null for cues common to every scam (secrecy, urgency) that don't identify a type. */
  scamType: ScamType | null;
  reason: string;
}

// Layer 1 of the scam scorer: instant keyword rules. Layer 2 (`llm.ts`, a Claude pass over the
// rolling transcript) runs alongside and can only raise the score.
const RULES: ScamRule[] = [
  {
    pattern:
      /\b(passwords?|passcodes?|pin (number|code)|your pin|one[- ]time (code|password|passcode)|verification code|security code|login details|log ?in details)\b/i,
    weight: 0.5,
    scamType: 'credential_theft',
    reason: 'asks for passwords or codes',
  },
  {
    pattern:
      /\b((credit|debit|bank) card (number|details|info)|card number|(last|first) (few|four|4|two|2|three|3|\w+ few) (digits|numbers)|account number|routing number|social security number|\bssn\b|cvv|security digits)\b/i,
    weight: 0.45,
    scamType: 'credential_theft',
    reason: 'asks for card or account numbers',
  },
  {
    pattern:
      /\b(transfer|move|send|wire)\b.{0,60}\b(to|into) (this|a|my|our|the|another|a new) (new |safe |secure |protected |different )?account\b|\b(safe|secure|protected) account\b/i,
    weight: 0.4,
    scamType: 'wire_transfer',
    reason: 'asks to move money to another account',
  },
  {
    pattern:
      /\b(this is|calling from|i'?m (calling )?from|i work (for|at)) (your|the) bank\b|\b(bank'?s )?fraud (department|team|prevention)\b|\bthe bank (wants|needs|asked|requires)\b/i,
    weight: 0.3,
    scamType: 'bank_impersonation',
    reason: 'claims to be the bank',
  },
  {
    pattern: /\b(gift ?cards?|google play cards?|apple cards?|itunes cards?|steam cards?|target cards?)\b/i,
    weight: 0.5,
    scamType: 'gift_card',
    reason: 'asks for gift cards',
  },
  {
    pattern: /\b(bitcoin|crypto(currency)?) (atm|machine|kiosk)\b|\bbuy (some )?bitcoin\b/i,
    weight: 0.5,
    scamType: 'crypto_atm',
    reason: 'asks for a crypto ATM payment',
  },
  {
    pattern:
      /\b(do not|don't|dont) (tell|mention|say anything)\b|\bkeep (this|it) (a )?secret\b|\bbetween (you and me|us)\b/i,
    weight: 0.4,
    scamType: null,
    reason: 'asks to keep it secret',
  },
  {
    pattern:
      /\b(irs|back taxes|tax(es)? (owed|debt)|social security (number )?(is |has been )?(suspended|compromised)|arrest warrant|warrant for your arrest)\b/i,
    weight: 0.4,
    scamType: 'government_impersonation',
    reason: 'claims to be the government',
  },
  {
    pattern:
      /\b(remote access|anydesk|teamviewer|microsoft support|refund department|your computer (has|is) (a )?(virus|infected|hacked))\b/i,
    weight: 0.4,
    scamType: 'tech_support',
    reason: 'tech-support script',
  },
  {
    pattern: /\b(bail|jail|arrested|in custody|police station)\b/i,
    weight: 0.35,
    scamType: 'grandparent',
    reason: 'mentions bail or jail',
  },
  {
    pattern: /\bit'?s me,? (grandma|grandpa|nana)\b|\b(grandma|grandpa|nana),? it'?s me\b/i,
    weight: 0.3,
    scamType: 'grandparent',
    reason: 'caller claims to be a grandchild',
  },
  {
    pattern: /\b(wire (the )?(money|transfer|it)|western union|moneygram)\b/i,
    weight: 0.3,
    scamType: 'wire_transfer',
    reason: 'asks for a wire transfer',
  },
  {
    pattern: /\b(plane ticket|visa fees?|customs fees?|stuck overseas)\b/i,
    weight: 0.25,
    scamType: 'romance',
    reason: 'needs money to travel or clear customs',
  },
  {
    pattern: /\b(right now|immediately|right away|within the hour|act now|hurry|urgent(ly)?|before it'?s too late)\b/i,
    weight: 0.2,
    scamType: null,
    reason: 'pressure to act now',
  },
];

/** Independent-evidence combination: risk = 1 − Π(1 − wᵢ) over matched rules. */
export function scoreText(text: string): ScamScore {
  const normalized = text.replace(/[’‘]/g, "'");
  let keep = 1;
  let typed: ScamRule | null = null;
  const reasons: string[] = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(normalized);
    if (!m) continue;
    keep *= 1 - rule.weight;
    reasons.push(`${rule.reason} ("${m[0]}")`);
    if (rule.scamType && (!typed || rule.weight > typed.weight)) typed = rule;
  }
  const risk = Math.round((1 - keep) * 1000) / 1000;
  if (risk === 0) return NO_SCAM;
  return { risk, scamType: typed?.scamType ?? 'unknown', reasons };
}

export function maxScore(a: ScamScore, b: ScamScore): ScamScore {
  return b.risk > a.risk ? b : a;
}

/** Like maxScore, but keeps every reason so alerts show both the keyword hits and the LLM's read. */
export function mergeScores(a: ScamScore, b: ScamScore): ScamScore {
  if (a.risk === 0) return b;
  if (b.risk === 0) return a;
  const top = maxScore(a, b);
  return { risk: top.risk, scamType: top.scamType, reasons: [...new Set([...a.reasons, ...b.reasons])] };
}
