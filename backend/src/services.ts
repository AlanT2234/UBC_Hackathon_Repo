import { AlertService } from './alerts/service.js';
import { FanoutNotifier, LogNotifier, TelegramNotifier, type Notifier } from './alerts/notifier.js';
import type { Config } from './config.js';
import { systemClock, type Clock } from './domain/types.js';
import { EventBus } from './events/bus.js';
import { DeadlineScheduler } from './jobs/scheduler.js';
import type { Logger } from './logger.js';
import { PayeeDirectory } from './payees/directory.js';
import { PolicyEngine } from './policy/engine.js';
import { CallMonitor } from './scam/monitor.js';
import { seedDemo } from './seed.js';
import { MockVaultClient } from './vault/mock.js';

export type Services = ReturnType<typeof createServices>;

export function createServices(config: Config, deps: { log: Logger; now?: Clock; notifier?: Notifier }) {
  const { log } = deps;
  const now = deps.now ?? systemClock;
  const bus = new EventBus(log);
  const directory = new PayeeDirectory();
  // TODO: swap for the Anchor client once safespend_vault's IDL is published.
  const client = new MockVaultClient(bus, now);

  const notifier =
    deps.notifier ??
    new FanoutNotifier([
      new LogNotifier(log),
      ...(config.telegram ? [new TelegramNotifier(config.telegram.botToken, config.telegram.chatId, log)] : []),
    ]);
  const alerts = new AlertService(notifier, directory, { dashboardUrl: config.dashboardUrl, timeZone: config.alertTimeZone });
  alerts.attach(bus);

  const scheduler = new DeadlineScheduler(client, now, log);
  scheduler.attach(bus);

  const calls = new CallMonitor(client, alerts, now, log);
  const engine = new PolicyEngine({ client, directory, calls, alerts, now });
  const demo = seedDemo(client, directory, { holdSeconds: config.demoHoldSeconds });

  return { config, log, now, bus, directory, client, alerts, scheduler, calls, engine, demo, defaultVault: demo.vault };
}
