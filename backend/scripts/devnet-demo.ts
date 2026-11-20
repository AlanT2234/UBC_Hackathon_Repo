/**
 * Onchain proof for the presentation: the deployed `safespend_vault` program on Solana devnet
 * enforcing Dorothy's rules, with an Explorer link for every transaction. Independent of the
 * backend, which keeps using its in-memory mirror of the program for the live dashboard.
 *
 *   npm run devnet -- setup            create test USDC, Dorothy's vault, her payees, $1,200
 *   npm run devnet -- setup --fresh    same, with a brand-new vault (resets the weekly cap)
 *   npm run devnet -- run [--step]     the presentation beats (--step waits for Enter between them)
 *   npm run devnet -- status           balances, limits and links
 *
 * Keys live in .devnet/ (gitignored). They are throwaway devnet keys, never use them on mainnet.
 * SOLANA_RPC_URL overrides the public devnet endpoint, which rate-limits.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { AnchorProvider, BN, Program, Wallet, type Idl } from '@anchor-lang/core';
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type Transaction,
  type TransactionError,
} from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const STATE_DIR = '.devnet';
const KEYS_FILE = `${STATE_DIR}/keys.json`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const USDC = 1_000_000; // 6 decimals
const DAY = 24 * 60 * 60;

const ROLES = ['payer', 'senior', 'sam', 'priya', 'maple', 'agent', 'maria', 'electric', 'scammer'] as const;
type Role = (typeof ROLES)[number];
type Keys = Record<Role, Keypair>;

// web3.js retries rate-limited requests by itself; keep its retry chatter off the presentation screen.
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '');
  if (first.includes('429 Too Many Requests') || first.startsWith('ws error')) return;
  consoleError(...args);
};

/** Plain-language gloss for errors that come from Anchor itself rather than SafeNSound's rules. */
const ERROR_GLOSS: Record<string, string> = {
  AccountNotInitialized: "her payee list has no entry for this account, so the program won't pay it",
};

const idl = JSON.parse(readFileSync('../idl/safespend_vault.json', 'utf8')) as Idl;
const connection = new Connection(RPC_URL, 'confirmed');

// ---------------------------------------------------------------------------------------------
// Keys and state

function loadKeys(fresh: boolean): Keys {
  mkdirSync(STATE_DIR, { recursive: true });
  const saved: Partial<Record<Role, number[]>> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
  const keys = {} as Keys;
  for (const role of ROLES) {
    // --fresh keeps the funded payer; everything else (so the vault address) is new.
    const keep = saved[role] && !(fresh && role !== 'payer');
    keys[role] = keep ? Keypair.fromSecretKey(Uint8Array.from(saved[role]!)) : Keypair.generate();
  }
  writeFileSync(KEYS_FILE, JSON.stringify(Object.fromEntries(ROLES.map((r) => [r, Array.from(keys[r].secretKey)])), null, 2));
  return keys;
}

type State = { mint?: string };

function loadState(): State {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
}

function saveState(state: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------------------------
// Addresses and links

const programId = new PublicKey((idl as { address: string }).address);

function vaultPda(senior: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), senior.toBuffer()], programId)[0];
}

function payeePda(vault: PublicKey, recipient: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('payee'), vault.toBuffer(), recipient.toBuffer()], programId)[0];
}

const txUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const addressUrl = (a: PublicKey) => `https://explorer.solana.com/address/${a.toBase58()}?cluster=devnet`;
const dollars = (units: bigint | number | BN) => `$${(Number(units.toString()) / USDC).toFixed(2)}`;

// ---------------------------------------------------------------------------------------------
// Sending

type Sent = { signature: string; err: TransactionError | null; error: string | null };

/** Sends with preflight skipped so a rejected transaction still lands onchain and shows on Explorer. */
async function send(tx: Transaction, signers: Keypair[]): Promise<Sent> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const { value } = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (!value.err) return { signature, err: null, error: null };
  return { signature, err: value.err, error: await programError(signature, value.err) };
}

/** "OverPerPaymentLimit: Amount is over the per-payment limit", from the program's own logs. */
async function programError(signature: string, err: TransactionError): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const info = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const logs = info?.meta?.logMessages ?? [];
    for (const line of logs) {
      const m = /Error Code: (\w+)\. Error Number: \d+\. Error Message: (.*?)\.?$/.exec(line);
      if (m) return `${m[1]}: ${ERROR_GLOSS[m[1]!] ?? m[2]}`;
    }
    if (info) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return JSON.stringify(err);
}

async function mustSend(label: string, tx: Transaction, signers: Keypair[]): Promise<string> {
  const sent = await send(tx, signers);
  if (sent.err) throw new Error(`${label} failed: ${sent.error}\n${txUrl(sent.signature)}`);
  return sent.signature;
}

// ---------------------------------------------------------------------------------------------
// Context

function context(keys: Keys, state: State) {
  const provider = new AnchorProvider(connection, new Wallet(keys.payer), { commitment: 'confirmed' });
  const program = new Program(idl, provider);
  const vault = vaultPda(keys.senior.publicKey);
  const mint = state.mint ? new PublicKey(state.mint) : null;
  const vaultToken = mint ? getAssociatedTokenAddressSync(mint, vault, true) : null;
  return { program, vault, mint, vaultToken };
}

type Ctx = ReturnType<typeof context>;

/** An instruction builder by IDL name (camelCase), e.g. `ix(ctx, 'pay')(amount)`. */
function ix(ctx: Ctx, name: string) {
  const method = ctx.program.methods[name];
  if (!method) throw new Error(`The program IDL has no instruction ${name}`);
  return method;
}

/** Builds a `pay` from the agent session key, the only key the backend holds. */
function payTx(keys: Keys, ctx: Ctx, recipient: PublicKey, amount: number): Promise<Transaction> {
  return ix(ctx, 'pay')(new BN(Math.round(amount * USDC)))
    .accountsPartial({
      agent: keys.agent.publicKey,
      vault: ctx.vault,
      payee: payeePda(ctx.vault, recipient),
      recipient,
      mint: ctx.mint!,
      vaultToken: ctx.vaultToken!,
      recipientToken: getAssociatedTokenAddressSync(ctx.mint!, recipient),
    })
    .transaction();
}

async function fetchVault(ctx: Ctx) {
  // The account client is typed from the IDL at runtime; this is its decoded `Vault`.
  const accounts = ctx.program.account as unknown as Record<string, { fetchNullable(a: PublicKey): Promise<any> }>;
  return accounts.vault!.fetchNullable(ctx.vault);
}

// ---------------------------------------------------------------------------------------------
// Commands

async function ensureFunded(payer: Keypair): Promise<void> {
  const balance = await connection.getBalance(payer.publicKey);
  if (balance >= 0.05 * LAMPORTS_PER_SOL) return;
  console.log(`Fee payer ${payer.publicKey.toBase58()} has ${balance / LAMPORTS_PER_SOL} SOL; requesting a devnet airdrop...`);
  try {
    const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('Airdrop received.');
  } catch {
    console.error(
      `\nThe devnet faucet refused (it rate-limits). Send at least 0.1 devnet SOL to:\n\n  ${payer.publicKey.toBase58()}\n\n` +
        'using https://faucet.solana.com (choose Devnet), or from another devnet wallet, then re-run setup.',
    );
    process.exit(1);
  }
}

async function setup(fresh: boolean): Promise<void> {
  const keys = loadKeys(fresh);
  const state = loadState();
  await ensureFunded(keys.payer);

  if (!state.mint) {
    const mint = await createMint(connection, keys.payer, keys.payer.publicKey, null, 6);
    state.mint = mint.toBase58();
    saveState(state);
    console.log(`Created test USDC mint ${state.mint}`);
  }
  const ctx = context(keys, state);
  const mint = ctx.mint!;

  if (!(await fetchVault(ctx))) {
    const tx = await ix(ctx, 'initVault')({
        guardians: [keys.sam.publicKey, keys.priya.publicKey, keys.maple.publicKey],
        professionalMask: 0b100, // Maple Credit Union's fraud desk
        bigAmountThreshold: new BN(500 * USDC),
        perPaymentLimit: new BN(100 * USDC),
        weeklyCap: new BN(300 * USDC),
        holdSeconds: new BN(1800),
        unfreezeDelaySeconds: new BN(2 * DAY),
        changeDelaySeconds: new BN(DAY),
        agentSessionKey: keys.agent.publicKey,
      })
      .accountsPartial({ payer: keys.payer.publicKey, senior: keys.senior.publicKey, vault: ctx.vault, mint, vaultToken: ctx.vaultToken! })
      .transaction();
    console.log(`Created Dorothy's vault  ${txUrl(await mustSend('init_vault', tx, [keys.payer, keys.senior]))}`);
  }

  for (const [name, who] of [
    ['Maria', keys.maria],
    ['City Electric', keys.electric],
  ] as const) {
    const payee = payeePda(ctx.vault, who.publicKey);
    if (await connection.getAccountInfo(payee)) continue;
    const tx = await ix(ctx, 'addPayee')(who.publicKey)
      .accountsPartial({ payer: keys.payer.publicKey, proposer: keys.senior.publicKey, vault: ctx.vault, payee })
      .transaction();
    console.log(`Added payee ${name.padEnd(14)} ${txUrl(await mustSend('add_payee', tx, [keys.payer, keys.senior]))}`);
  }

  if (!(await fetchVault(ctx)).setupComplete) {
    const tx = await ix(ctx, 'completeSetup')().accountsPartial({ senior: keys.senior.publicKey, vault: ctx.vault }).transaction();
    console.log(`Finished onboarding      ${txUrl(await mustSend('complete_setup', tx, [keys.payer, keys.senior]))}`);
  }

  // Token accounts for everyone who might receive money, so a rejection is always about the rules.
  for (const who of [keys.maria, keys.electric, keys.scammer]) {
    await getOrCreateAssociatedTokenAccount(connection, keys.payer, mint, who.publicKey);
  }

  const balance = (await getAccount(connection, ctx.vaultToken!)).amount;
  if (balance === 0n) {
    await mintTo(connection, keys.payer, mint, ctx.vaultToken!, keys.payer, 1200 * USDC);
    console.log('Funded the vault with $1,200.00 test USDC');
  }
  await status();
}

async function status(): Promise<void> {
  const keys = loadKeys(false);
  const state = loadState();
  if (!state.mint) throw new Error('Run setup first');
  const ctx = context(keys, state);
  const v = await fetchVault(ctx);
  if (!v) throw new Error('No vault yet. Run setup');
  const balance = (await getAccount(connection, ctx.vaultToken!)).amount;
  console.log(`
Program       ${addressUrl(programId)}
Vault         ${addressUrl(ctx.vault)}
Balance       ${dollars(balance)} test USDC
Limits        ${dollars(v.perPaymentLimit)} per payment, ${dollars(v.weeklyCap)} a week (${dollars(v.spentInWindow)} spent this week)
Frozen        ${v.frozen ? 'yes' : 'no'}
Agent key     ${keys.agent.publicKey.toBase58()}  (the only key the backend holds: pay, request_hold, sentinel freeze)`);
}

async function run(step: boolean): Promise<void> {
  const keys = loadKeys(false);
  const state = loadState();
  if (!state.mint) throw new Error('Run setup first');
  const ctx = context(keys, state);
  const v = await fetchVault(ctx);
  if (!v) throw new Error('No vault yet. Run setup');
  const rl = step ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const pause = async () => {
    if (rl) await rl.question('\n  Press Enter for the next step...');
  };

  if (v.frozen) {
    const tx = await ix(ctx, 'unfreeze')().accountsPartial({ guardian: keys.sam.publicKey, vault: ctx.vault }).transaction();
    await mustSend('unfreeze', tx, [keys.payer, keys.sam]);
    console.log('(Vault was frozen from an earlier run; Sam unfroze it.)');
  }
  const remaining = Number(v.weeklyCap.toString()) - Number(v.spentInWindow.toString());
  if (remaining < 20 * USDC) {
    throw new Error('This week\'s cap is used up from rehearsals. Run `npm run devnet -- setup --fresh` for a new vault.');
  }

  console.log(`\nDorothy's vault on Solana devnet: ${addressUrl(ctx.vault)}`);
  const results: { beat: string; outcome: string; link: string }[] = [];

  async function beat(title: string, expectOk: boolean, tx: Transaction, signers: Keypair[]) {
    console.log(`\n▶ ${title}`);
    const sent = await send(tx, signers);
    const outcome = sent.err ? `REJECTED by the program  ${sent.error}` : 'Confirmed';
    console.log(`  ${outcome}\n  ${txUrl(sent.signature)}`);
    if (!sent.err !== expectOk) console.log('  (unexpected outcome)');
    results.push({ beat: title, outcome: sent.err ? `rejected: ${sent.error?.split(':')[0]}` : 'confirmed', link: txUrl(sent.signature) });
    await pause();
  }

  const agent = [keys.payer, keys.agent];
  await beat('Within her rules: the agent pays Maria $20.00 for cleaning', true, await payTx(keys, ctx, keys.maria.publicKey, 20), agent);
  await beat(
    'Jailbreak: the same agent key tries to send Maria $900.00',
    false,
    await payTx(keys, ctx, keys.maria.publicKey, 900),
    agent,
  );
  await beat(
    "A scammer's account: $50.00 to someone who isn't on her payee list",
    false,
    await payTx(keys, ctx, keys.scammer.publicKey, 50),
    agent,
  );
  await beat(
    'Scam call detected: the sentinel freezes her payments',
    true,
    await ix(ctx, 'freeze')().accountsPartial({ authority: keys.agent.publicKey, vault: ctx.vault }).transaction(),
    agent,
  );
  await beat('While frozen: even $20.00 to Maria is refused', false, await payTx(keys, ctx, keys.maria.publicKey, 20), agent);

  const tx = await ix(ctx, 'unfreeze')().accountsPartial({ guardian: keys.sam.publicKey, vault: ctx.vault }).transaction();
  const unfreezeSig = await mustSend('unfreeze', tx, [keys.payer, keys.sam]);
  console.log(`\n▶ Sam (a guardian) turns payments back on\n  Confirmed\n  ${txUrl(unfreezeSig)}`);
  rl?.close();

  console.log('\nSummary');
  for (const r of results) console.log(`  ${r.outcome.padEnd(34)} ${r.beat}`);
  await status();
}

// ---------------------------------------------------------------------------------------------

const [command = 'run', ...flags] = process.argv.slice(2);
try {
  if (command === 'setup') await setup(flags.includes('--fresh'));
  else if (command === 'run') await run(flags.includes('--step'));
  else if (command === 'status') await status();
  else throw new Error(`Unknown command ${command}. Use setup, run or status.`);
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
