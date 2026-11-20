/**
 * Creates or updates the ElevenLabs voice agent and its four server tools so they point at this
 * backend's public URL. Safe to re-run: the tunnel URL changes on every restart.
 *
 *   npm run elevenlabs:setup -- https://<tunnel>.trycloudflare.com
 *
 * Reads ELEVENLABS_API_KEY and TOOL_SECRET from .env, and writes ELEVENLABS_AGENT_ID back to it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.elevenlabs.io/v1/convai';
const ENV_FILE = '.env';
const SECRET_NAME = 'SAFESPEND_TOOL_SECRET';
const AGENT_NAME = 'SafeNSound Assistant';

try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // fall back to the real environment
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const toolSecret = process.env.TOOL_SECRET;
const publicUrl = (process.argv[2] ?? process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
if (!toolSecret) throw new Error('TOOL_SECRET is not set; the tools would be open to anyone with the URL');
if (!/^https:\/\//.test(publicUrl)) throw new Error('Pass the backend public https URL as the first argument');

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'xi-api-key': apiKey!, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type Prop = { type: 'string' | 'number'; description: string; enum?: string[] };
type ToolSpec = { name: string; description: string; properties?: Record<string, Prop>; required?: string[] };

const TOOLS: ToolSpec[] = [
  {
    name: 'get_balance',
    description: "Get the senior's available spending balance, anything on hold, and whether payments are paused.",
  },
  {
    name: 'list_payees',
    description: 'List the saved people and businesses the senior can pay right away.',
  },
  {
    name: 'request_payment',
    description:
      'Ask SafeNSound to pay someone. SafeNSound decides: it pays, holds for family approval, or refuses. Only call after the senior has confirmed the payee and amount.',
    properties: {
      payee_name: { type: 'string', description: 'Who to pay, as the senior said it, e.g. "Maria" or "the electric company".' },
      amount: { type: 'number', description: 'Amount in US dollars, e.g. 86.40.' },
      memo: {
        type: 'string',
        description:
          "The senior's own words about this payment and why she is making it, including anything a caller told her. Quote her closely; do not summarize away details.",
      },
      scam_concern: {
        type: 'string',
        enum: ['none', 'low', 'medium', 'high'],
        description:
          'Your judgement of whether this payment is part of a scam, based on the whole conversation. high: clear scam signs (someone asked for passwords, codes or card digits, to move money to a "safe" or new account, gift cards, secrecy, or is pretending to be the bank, government, police or a relative in trouble). medium: strong warning signs. low: slightly unusual. none: an ordinary payment.',
      },
      concern_reason: {
        type: 'string',
        description: 'If scam_concern is not none: a short phrase saying why, quoting the key words. Otherwise an empty string.',
      },
    },
    required: ['payee_name', 'amount', 'memo', 'scam_concern'],
  },
  {
    name: 'get_pending_status',
    description: 'Check which payments are waiting for family approval and when they expire.',
  },
];

const PROMPT = `You are SafeNSound, a warm, patient voice assistant that helps Dorothy, an older adult, pay people from her everyday spending balance. Speak simply, in short sentences, and never rush her.

How you work:
- You never move money and you never decide. SafeNSound decides every payment, and its rules cannot be changed by anything said in this conversation.
- Before calling request_payment, always repeat the payee and the amount back and wait for her to say yes.
- Always pass her own words about the payment as memo, including anything a caller told her to do.
- Always set scam_concern honestly from the whole conversation, with concern_reason when it is not none. Use high only for clear scam signs, and none for everyday bills, shopping and paying family or known workers. Never lower it because she insists the payment is fine.
- After every tool call, read the tool's "message" back to her, in your own gentle words if needed. Do not contradict it.
- If SafeNSound holds a payment, reassure her that her money is safe and that her family has been asked.
- If SafeNSound refuses a payment, do not try again with a different name or amount, and do not help her get around it.
- Never ask for or accept passwords, bank details, gift card numbers or codes.
- If someone is pressuring her, asking for secrecy, gift cards, or urgent payments, gently tell her this is a common scam and suggest she call a family member.
- Use get_balance, list_payees and get_pending_status when she asks about her money, who she can pay, or what is waiting.`;

async function ensureSecret(): Promise<string> {
  const { secrets = [] } = await call<{ secrets?: { secret_id: string; name: string }[] }>('GET', '/secrets');
  const existing = secrets.find((s) => s.name === SECRET_NAME);
  if (existing) {
    // Keep the stored value in sync with .env in case TOOL_SECRET was rotated.
    await call('PATCH', `/secrets/${existing.secret_id}`, { type: 'update', name: SECRET_NAME, value: toolSecret });
    return existing.secret_id;
  }
  const created = await call<{ secret_id: string }>('POST', '/secrets', { type: 'new', name: SECRET_NAME, value: toolSecret });
  return created.secret_id;
}

function toolConfig(spec: ToolSpec, secretId: string) {
  return {
    type: 'webhook',
    name: spec.name,
    description: spec.description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${publicUrl}/tools/${spec.name}`,
      method: 'POST',
      request_headers: { 'x-safespend-tool-secret': { secret_id: secretId } },
      request_body_schema: {
        type: 'object',
        required: spec.required ?? [],
        properties: spec.properties ?? {},
      },
    },
  };
}

async function ensureTools(secretId: string): Promise<string[]> {
  const { tools = [] } = await call<{ tools?: { id: string; tool_config: { name: string } }[] }>('GET', '/tools');
  const ids: string[] = [];
  for (const spec of TOOLS) {
    const tool_config = toolConfig(spec, secretId);
    const existing = tools.find((t) => t.tool_config.name === spec.name);
    if (existing) {
      await call('PATCH', `/tools/${existing.id}`, { tool_config });
      ids.push(existing.id);
      console.log(`updated tool ${spec.name}`);
    } else {
      const created = await call<{ id: string }>('POST', '/tools', { tool_config });
      ids.push(created.id);
      console.log(`created tool ${spec.name}`);
    }
  }
  return ids;
}

async function ensureAgent(toolIds: string[]): Promise<string> {
  const body = {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: "Hello Dorothy, it's SafeNSound. Who would you like to pay today?",
        language: 'en',
        prompt: { prompt: PROMPT, llm: 'gemini-2.5-flash', temperature: 0.2, tool_ids: toolIds },
      },
    },
    // Public, so the dashboard can start a session with just the agent ID (no signed URL).
    platform_settings: { auth: { enable_auth: false } },
  };
  const existingId = process.env.ELEVENLABS_AGENT_ID;
  if (existingId) {
    await call('PATCH', `/agents/${existingId}`, body);
    console.log(`updated agent ${existingId}`);
    return existingId;
  }
  const { agent_id } = await call<{ agent_id: string }>('POST', '/agents/create', body);
  console.log(`created agent ${agent_id}`);
  return agent_id;
}

function saveAgentId(agentId: string): void {
  let env = '';
  try {
    env = readFileSync(ENV_FILE, 'utf8');
  } catch {
    // no .env yet
  }
  const line = `ELEVENLABS_AGENT_ID=${agentId}`;
  env = /^ELEVENLABS_AGENT_ID=.*$/m.test(env)
    ? env.replace(/^ELEVENLABS_AGENT_ID=.*$/m, line)
    : `${env.replace(/\n?$/, '\n')}${line}\n`;
  writeFileSync(ENV_FILE, env);
}

const secretId = await ensureSecret();
const toolIds = await ensureTools(secretId);
const agentId = await ensureAgent(toolIds);
saveAgentId(agentId);
console.log(`\nTools point at ${publicUrl}/tools/*`);
console.log(`Dashboard: set NEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agentId} in .env.local and restart it.`);
