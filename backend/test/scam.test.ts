import { describe, expect, it } from 'vitest';
import { scoreText } from '../src/scam/rules.js';
import { setup } from './helpers.js';

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
