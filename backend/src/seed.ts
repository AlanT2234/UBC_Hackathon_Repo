import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import type { Pubkey } from './domain/types.js';
import { parseDollars } from './money.js';
import type { PayeeDirectory } from './payees/directory.js';
import type { MockVaultClient } from './vault/mock.js';

/** Deterministic demo keys, so the vault address is stable across restarts. */
export function demoKey(label: string): Pubkey {
  const seed = createHash('sha256').update(`safespend-demo:${label}`).digest();
  return Keypair.fromSeed(seed).publicKey.toBase58();
}

export interface DemoIds {
  vault: Pubkey;
  senior: Pubkey;
  guardians: { sam: Pubkey; priya: Pubkey; maple: Pubkey };
  payees: { maria: Pubkey; electric: Pubkey; tyler: Pubkey };
  businesses: { plumber: Pubkey };
}

const HOUR = 60 * 60;

/** Dorothy's vault from the demo script: three guardians (one professional), three known payees. */
export function seedDemo(client: MockVaultClient, directory: PayeeDirectory, opts: { holdSeconds: number }): DemoIds {
  const ids: DemoIds = {
    vault: demoKey('dorothy-vault'),
    senior: demoKey('dorothy'),
    guardians: { sam: demoKey('sam'), priya: demoKey('priya'), maple: demoKey('maple-cu-fraud-desk') },
    payees: { maria: demoKey('maria'), electric: demoKey('city-electric'), tyler: demoKey('tyler') },
    businesses: { plumber: demoKey('mikes-plumbing') },
  };

  client.createVault({
    address: ids.vault,
    senior: ids.senior,
    guardians: [ids.guardians.sam, ids.guardians.priya, ids.guardians.maple],
    professionalMask: 0b100, // Maple Credit Union's fraud desk is the vetted professional
    bigAmountThreshold: parseDollars(500),
    perPaymentLimit: parseDollars(100),
    weeklyCap: parseDollars(300),
    holdSeconds: opts.holdSeconds,
    unfreezeDelaySeconds: 48 * HOUR,
    changeDelaySeconds: 24 * HOUR,
    balance: parseDollars(1200),
  });

  directory.setLabel(ids.vault, 'Dorothy');
  directory.setLabel(ids.senior, 'Dorothy');
  directory.setLabel(ids.guardians.sam, 'Sam');
  directory.setLabel(ids.guardians.priya, 'Priya');
  directory.setLabel(ids.guardians.maple, 'Maple Credit Union fraud desk');

  const payees: [Pubkey, string, string[]][] = [
    [ids.payees.maria, 'Maria', ['cleaner', 'housekeeper']],
    [ids.payees.electric, 'City Electric', ['electric', 'electricity', 'power', 'power bill', 'hydro']],
    [ids.payees.tyler, 'Tyler', ['grandson']],
  ];
  for (const [recipient, name, aliases] of payees) {
    directory.register({ name, recipient, vault: ids.vault, aliases, kind: 'payee' });
    client.seedPayee(ids.vault, recipient);
  }

  directory.register({
    name: "Mike's Plumbing",
    recipient: ids.businesses.plumber,
    vault: null,
    aliases: ['plumber', 'plumbing', 'mike'],
    kind: 'business',
  });

  return ids;
}
