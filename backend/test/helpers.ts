import { pino } from 'pino';
import { MemoryNotifier } from '../src/alerts/notifier.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/http/app.js';
import type { ScamScorer } from '../src/scam/llm.js';
import type { ScamScore } from '../src/scam/rules.js';
import { createServices } from '../src/services.js';

/** Stand-in for the Claude layer: flags any text containing `trigger`, and records what it saw. */
export function fakeScamScorer(trigger: RegExp, score: ScamScore) {
  const seen: { text: string; source: string }[] = [];
  const scorer: ScamScorer = {
    score: async (text, source) => {
      seen.push({ text, source });
      return trigger.test(text) ? score : { risk: 0, scamType: null, reasons: [] };
    },
  };
  return { scorer, seen };
}

export const T0 = 1_763_500_000;

export function testClock(start = T0) {
  let t = start;
  const now = () => t;
  return { now, advance: (seconds: number) => (t += seconds) };
}

export function setup(env: Record<string, string> = {}, deps: { scamScorer?: ScamScorer } = {}) {
  const clock = testClock();
  const notifier = new MemoryNotifier();
  const config = loadConfig({ DEMO_HOLD_SECONDS: '600', ...env });
  const services = createServices(config, { log: pino({ level: 'silent' }), now: clock.now, notifier, ...deps });
  return { ...services, clock, notifier, app: () => buildApp(services) };
}
