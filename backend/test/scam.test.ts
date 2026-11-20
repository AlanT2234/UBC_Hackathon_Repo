import Anthropic from '@anthropic-ai/sdk';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { parseDollars } from '../src/money.js';
import { ClaudeScamScorer } from '../src/scam/llm.js';
import { scoreText } from '../src/scam/rules.js';
import { fakeScamScorer, setup } from './helpers.js';

describe('scoreText', () => {
  it('scores ordinary conversation as zero', () => {
    expect(scoreText('Hi Mom, just calling to see how the garden is doing.').risk).toBe(0);
  });

  it('combines cues and names the scam type', () => {
    const s = scoreText('Grandma it’s me, I’m in jail and need bail. Don’t tell Mom. Buy Google Play cards right now.');
    // grandchild + bail + secrecy + gift cards + urgency: 1 − .7·.65·.6·.5·.8
    expect(s.risk).toBe(0.891);
    expect(s.scamType).toBe('gift_card');
    expect(s.reasons).toHaveLength(5);
  });

  it('handles curly apostrophes from transcription', () => {
    expect(scoreText('please don’t tell anyone').risk).toBeGreaterThan(0);
  });
});

describe('CallMonitor', () => {
  it('freezes the vault mid-call once cues add up, even across chunks', async () => {
    const s = setup();
    const call = s.calls.start(s.demo.vault, '+1 555 0199');
    await s.calls.ingest(call.id, 'Hello, this is officer Davis. Your grandson was arrested');
    expect((await s.client.getVault(s.demo.vault)).frozen).toBe(false);
    const after = await s.calls.ingest(call.id, 'and we need the bail in gift cards today. Do not tell');
    expect(after.frozeVault).toBe(true);
    expect((await s.client.getVault(s.demo.vault)).frozen).toBe(true);
    expect(s.notifier.sent.some((m) => m.startsWith('🚨 Possible scam call to Dorothy from +1 555 0199'))).toBe(true);
  });
});

describe('scam signs in what she says', () => {
  const ask = async (payeeName: string, amount: number, context: string) => {
    const s = setup();
    const d = await s.engine.requestPayment({ vault: s.demo.vault, payeeName, amount: parseDollars(amount), context });
    return { d, frozen: (await s.client.getVault(s.demo.vault)).frozen };
  };

  it('never pays a saved payee instantly when she mentions a clear scam sign', async () => {
    for (const context of ['Maria needs me to buy her some gift cards', 'keep it a secret', 'read her the code they texted me']) {
      const { d, frozen } = await ask('Maria', 50, context);
      expect(d.outcome, context).toBe('held');
      expect(frozen).toBe(false);
      expect(d.message).toMatch(/^Something about this sounds like a scam warning sign/);
    }
  });

  it('refuses and pauses payments for strong signs, even to a saved payee within limits', async () => {
    const { d, frozen } = await ask('Maria', 50, 'gift cards, and do not tell anyone');
    expect(d).toMatchObject({ outcome: 'refused', code: 'scam_suspected' });
    expect(frozen).toBe(true);
  });

  it('still pays everyday requests, including plain urgency', async () => {
    for (const context of ['for cleaning on Tuesday', 'please do it right away']) {
      expect((await ask('Maria', 50, context)).d.outcome, context).toBe('paid');
    }
  });

  it('shows guardians the scam signs on a hold that also broke a rule', async () => {
    const { d } = await ask('plumber', 50, 'he wants it in gift cards');
    expect(d.outcome).toBe('held');
    if (d.outcome !== 'held') throw new Error('expected a hold');
    expect(d.reasons).toEqual(expect.arrayContaining(["Mike's Plumbing is not a saved payee", 'asks for gift cards ("gift cards")']));
  });
});

describe('after a scam call is unfrozen', () => {
  it('holds an ordinary bill for the next 15 minutes and says why, then pays it again', async () => {
    const s = setup();
    const call = s.calls.start(s.demo.vault, '+1 555 0142');
    await s.calls.ingest(call.id, 'This is the fraud department at your bank. Read me the last four digits of your card right away.');
    expect((await s.client.getVault(s.demo.vault)).frozen).toBe(true);
    await s.client.unfreeze(s.demo.vault, s.demo.guardians.sam);

    s.clock.advance(60);
    const bill = { vault: s.demo.vault, payeeName: 'electric', amount: parseDollars(86.4) };
    const held = await s.engine.requestPayment(bill);
    expect(held).toMatchObject({ outcome: 'held', reasons: ['a suspicious call to her in the last few minutes'] });
    expect(held.message).toMatch(/^There was a suspicious call on your line a few minutes ago/);
    expect(held.message).not.toContain('usual limit');

    s.clock.advance(16 * 60);
    expect(await s.engine.requestPayment(bill)).toMatchObject({ outcome: 'paid' });
  });
});

describe('credential and account-transfer rules', () => {
  it.each([
    ['the bank wants your passwords', 'credential_theft'],
    ['please say the last few digits of your credit card number', 'credential_theft'],
    ['transfer 2000 dollars to this account', 'wire_transfer'],
    ['we need to move your savings into a safe account', 'wire_transfer'],
    ['read me the one-time code we just texted you', 'credential_theft'],
    ['read her the code they texted me', 'credential_theft'],
    ['the bank texted you a code, what is it', 'credential_theft'],
  ])('flags "%s"', (text, scamType) => {
    const s = scoreText(text);
    expect(s.risk).toBeGreaterThanOrEqual(0.4);
    expect(s.scamType).toBe(scamType);
  });

  it.each(['Please pay City Electric $86.40 for the electric bill.', 'pin the photo to the fridge', 'Tyler opened a savings account'])(
    'leaves "%s" alone',
    (text) => {
      expect(scoreText(text).risk).toBe(0);
    },
  );
});

describe('LLM scam layer', () => {
  const HIGH = { risk: 0.85, scamType: 'credential_theft' as const, reasons: ['asks her to read the numbers on her card'] };

  it('freezes a call the keyword rules miss, after the background pass', async () => {
    const { scorer, seen } = fakeScamScorer(/numbers on the back/i, HIGH);
    const s = setup({}, { scamScorer: scorer });
    const call = s.calls.start(s.demo.vault, '+1 555 0142');
    const text = 'Hi Dorothy, I just need you to read me the numbers on the back';
    expect(scoreText(text).risk).toBe(0);
    await s.calls.ingest(call.id, text);
    await s.calls.settled();
    expect(s.calls.get(call.id)).toMatchObject({ frozeVault: true, score: { risk: 0.85, reasons: HIGH.reasons } });
    expect((await s.client.getVault(s.demo.vault)).frozen).toBe(true);
    expect(seen[0]).toMatchObject({ source: 'call' });
  });

  it('folds chunks that arrive mid-pass into one follow-up pass', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    const s = setup({}, {
      scamScorer: {
        score: async (text) => {
          seen.push(text);
          await gate;
          return { risk: 0, scamType: null, reasons: [] };
        },
      },
    });
    const call = s.calls.start(s.demo.vault, null);
    await s.calls.ingest(call.id, 'one');
    await s.calls.ingest(call.id, 'two');
    await s.calls.ingest(call.id, 'three');
    release();
    await s.calls.settled();
    expect(seen).toEqual(['one', 'one two three']);
  });

  it('refuses a payment when the LLM flags what the senior said, and keeps both layers’ reasons', async () => {
    const { scorer, seen } = fakeScamScorer(/card numbers/i, HIGH);
    const s = setup({}, { scamScorer: scorer });
    const d = await s.engine.requestPayment({
      vault: s.demo.vault,
      payeeName: 'Kevin',
      amount: parseDollars(50),
      context: 'Kevin said to do it right now, he needs my card numbers to fix my computer',
    });
    expect(d).toMatchObject({ outcome: 'refused', code: 'scam_suspected' });
    if (d.outcome !== 'refused') throw new Error('expected refusal');
    expect(d.reasons).toEqual(expect.arrayContaining(['asks her to read the numbers on her card']));
    expect(d.reasons.some((r) => r.startsWith('pressure to act now'))).toBe(true);
    expect(seen).toEqual([{ text: expect.stringContaining('card numbers'), source: 'payment_request' }]);
  });

  it('skips the LLM when there is nothing said to score', async () => {
    const { scorer, seen } = fakeScamScorer(/./, HIGH);
    const s = setup({}, { scamScorer: scorer });
    expect(await s.engine.requestPayment({ vault: s.demo.vault, payeeName: 'Maria', amount: parseDollars(20) })).toMatchObject({
      outcome: 'paid',
    });
    expect(seen).toEqual([]);
  });

  it('falls back to keyword rules when Claude is unreachable', async () => {
    const client = new Anthropic({ apiKey: 'test', baseURL: 'http://127.0.0.1:9', maxRetries: 0 });
    const scorer = new ClaudeScamScorer(pino({ level: 'silent' }), { model: 'claude-opus-5-5', paymentTimeoutMs: 2000, callTimeoutMs: 2000 }, client);
    expect(await scorer.score('hello', 'payment_request')).toEqual({ risk: 0, scamType: null, reasons: [] });
  });

  it('is off without an API key', () => {
    expect(loadConfig({}).scamLlm).toBeNull();
    expect(loadConfig({ ANTHROPIC_API_KEY: 'k', SCAM_LLM: 'false' }).scamLlm).toBeNull();
    expect(loadConfig({ ANTHROPIC_API_KEY: 'k' }).scamLlm).toMatchObject({ model: 'claude-opus-5-5' });
  });
});
