import { loadConfig } from './config.js';
import { buildApp } from './http/app.js';
import { createLogger } from './logger.js';
import { createServices } from './services.js';

try {
  process.loadEnvFile();
} catch {
  // no .env: rely on the real environment
}

const config = loadConfig(process.env);
const log = createLogger(config.logLevel);
const services = createServices(config, { log });
const app = buildApp(services);

for (const [name, value] of [
  ['TOOL_SECRET', config.toolSecret],
  ['DASHBOARD_TOKEN', config.dashboardToken],
  ['WEBHOOK_TOKEN', config.webhookToken],
] as const) {
  if (!value) log.warn(`${name} is not set; that surface is unauthenticated (fine for local dev only)`);
}

if (config.scamLlm) log.info({ model: config.scamLlm.model }, 'scam scorer: keyword rules + Claude');
else log.warn('scam scorer: keyword rules only (set ANTHROPIC_API_KEY to add the Claude layer)');

services.scheduler.start(config.schedulerIntervalMs);
await app.listen({ port: config.port, host: config.host });
log.info({ vault: services.defaultVault }, 'SafeNSound backend ready (mock vault client)');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    services.scheduler.stop();
    void app.close().then(() => process.exit(0));
  });
}
