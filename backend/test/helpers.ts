import { pino } from 'pino';
import { MemoryNotifier } from '../src/alerts/notifier.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/http/app.js';
import { createServices } from '../src/services.js';

export const T0 = 1_763_500_000;

export function testClock(start = T0) {
  let t = start;
  const now = () => t;
  return { now, advance: (seconds: number) => (t += seconds) };
}

export function setup(env: Record<string, string> = {}) {
  const clock = testClock();
  const notifier = new MemoryNotifier();
  const config = loadConfig({ DEMO_HOLD_SECONDS: '600', ...env });
  const services = createServices(config, { log: pino({ level: 'silent' }), now: clock.now, notifier });
  return { ...services, clock, notifier, app: () => buildApp(services) };
}
