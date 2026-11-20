import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  DASHBOARD_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TOOL_SECRET: optionalString,
  DASHBOARD_TOKEN: optionalString,
  WEBHOOK_TOKEN: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  SOLANA_CLUSTER: z.enum(['devnet', 'mainnet-beta', 'localnet']).default('devnet'),
  ALERT_TIMEZONE: z.string().default('America/Chicago'),
  DEMO_ROUTES: flag(true),
  DEMO_HOLD_SECONDS: z.coerce.number().int().positive().default(1800),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  ANTHROPIC_API_KEY: optionalString,
  SCAM_LLM: flag(true),
  SCAM_LLM_MODEL: z.string().default('claude-opus-5-5'),
  SCAM_LLM_PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  SCAM_LLM_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined>) {
  const e = Env.parse(env);
  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    dashboardUrl: e.DASHBOARD_URL.replace(/\/$/, ''),
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    toolSecret: e.TOOL_SECRET,
    dashboardToken: e.DASHBOARD_TOKEN,
    webhookToken: e.WEBHOOK_TOKEN,
    telegram: e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID ? { botToken: e.TELEGRAM_BOT_TOKEN, chatId: e.TELEGRAM_CHAT_ID } : null,
    cluster: e.SOLANA_CLUSTER,
    alertTimeZone: e.ALERT_TIMEZONE,
    demoRoutes: e.DEMO_ROUTES,
    demoHoldSeconds: e.DEMO_HOLD_SECONDS,
    schedulerIntervalMs: e.SCHEDULER_INTERVAL_MS,
    // The SDK reads ANTHROPIC_API_KEY from the environment itself; this only decides whether layer 2 runs.
    scamLlm:
      e.SCAM_LLM && e.ANTHROPIC_API_KEY
        ? {
            model: e.SCAM_LLM_MODEL,
            paymentTimeoutMs: e.SCAM_LLM_PAYMENT_TIMEOUT_MS,
            callTimeoutMs: e.SCAM_LLM_CALL_TIMEOUT_MS,
          }
        : null,
  };
}
