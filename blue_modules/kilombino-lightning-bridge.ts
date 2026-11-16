/**
 * Kilombino's public XBT (BLAKE2b) -> SHA256 Lightning swap protocol.
 * Quote-only integration: DO NOT submit a hold invoice until the native LND
 * payment state machine, crash recovery and bridge settlement are audited.
 * No wallet credentials or secrets are sent to this API.
 * https://discord.com/channels/1376602546545754244/1376602547418300549/1567944272236380312
 */
import bolt11 from 'bolt11';
import { sha256 } from '@noble/hashes/sha256';
import { fetch } from '../util/fetch';

const BASE = 'https://bridge.kilombino.com';
const HASH = /^[0-9a-f]{64}$/i;
const INVOICE = /^lnbc[0-9]*[munp]?1[02-9ac-hj-np-z]+$/i;
const MAX_INVOICE_LENGTH = 8192;
const MAX_DIFFICULTY = 22;
const MAX_ATTEMPTS = 1 << 23;

export type BridgeInfo = {
  open: boolean;
  rate: number;
  spread: number;
  min_sat: number;
  max_sat: number;
  dirs: { toSHA256: { open: boolean; rate: number; spread: number; min_sat: number; max_sat: number } };
};
export type BridgeQuote = {
  originalInvoice: string;
  originalHash: string;
  originalSats: number;
  holdInvoice: string;
  paySats: number;
  expiresAt: number; // Unix milliseconds
  token: string; // Sensitive bearer token: never log or persist unencrypted.
  spread: number;
  rate: number;
};

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Lightning bridge response.');
  return value as Record<string, any>;
}

function finiteNonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid Lightning bridge rate or limit.');
  return value;
}

function sats(value: unknown): number {
  const n = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid Lightning bridge amount.');
  return n;
}

export function parseSha256Invoice(input: string): { invoice: string; hash: string; sats: number; expiresAt: number } {
  const invoice = input.trim().replace(/^lightning:/i, '').toLowerCase();
  if (invoice.length > MAX_INVOICE_LENGTH || !INVOICE.test(invoice)) throw new Error('Enter a valid SHA256 mainnet BOLT11 invoice.');
  let decoded: ReturnType<typeof bolt11.decode>;
  try {
    decoded = bolt11.decode(invoice);
  } catch {
    throw new Error('Could not decode the SHA256 Lightning invoice.');
  }
  const hash = decoded.tags.find(tag => tag.tagName === 'payment_hash')?.data;
  const expiry = decoded.tags.find(tag => tag.tagName === 'expire_time')?.data;
  const expiresAt = (Number(decoded.timestamp) + (expiry === undefined ? 3600 : Number(expiry))) * 1000;
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invoice payment hash is invalid.');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 15000) throw new Error('The SHA256 Lightning invoice has expired.');
  if (decoded.satoshis == null) throw new Error('Amountless SHA256 invoices are not supported yet.');
  return { invoice, hash: hash.toLowerCase(), sats: sats(decoded.satoshis), expiresAt };
}

async function json(path: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(BASE + path, { ...init, timeout: 10000, headers: { Accept: 'application/json', ...(init?.headers || {}) } });
  if (!response.ok) throw new Error('Lightning bridge unavailable (' + response.status + ').');
  return object(await response.json());
}

export async function bridgeInfo(): Promise<BridgeInfo> {
  const data = await json('/api/info');
  const dir = object(object(data.dirs).toSHA256);
  const min = sats(dir.min_sat);
  const max = sats(dir.max_sat);
  if (max < min) throw new Error('Invalid Lightning bridge limits.');
  const rate = finiteNonnegative(dir.rate);
  const spread = finiteNonnegative(dir.spread);
  if (!rate || spread >= 1) throw new Error('Invalid Lightning bridge quote parameters.');
  return { ...data, dirs: { ...data.dirs, toSHA256: { open: dir.open === true, rate, spread, min_sat: min, max_sat: max } } } as BridgeInfo;
}

function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (!byte) { bits += 8; continue; }
    for (let shift = 7; shift >= 0; shift--) {
      if (byte & (1 << shift)) return bits;
      bits++;
    }
  }
  return bits;
}

export async function solveBridgePow(challenge: string, paymentHash: string, bits: number): Promise<string> {
  if (typeof challenge !== 'string' || !challenge || challenge.length > 256 || !HASH.test(paymentHash) ||
      !Number.isInteger(bits) || bits < 0 || bits > MAX_DIFFICULTY) {
    throw new Error('Unsupported Lightning bridge challenge.');
  }
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const nonce = i.toString(36);
    const digest = sha256(Buffer.from(challenge + ':' + paymentHash.toLowerCase() + ':' + nonce, 'utf8'));
    if (leadingZeroBits(digest) >= bits) return nonce;
    // Yield so a malicious/difficult challenge cannot freeze the React Native UI.
    if (i % 2048 === 2047) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Lightning bridge challenge exceeded computation budget.');
}

/** Preview only. No money is moved. Caller must not treat this as payment authorization. */
export async function quoteSha256Invoice(input: string): Promise<BridgeQuote> {
  const original = parseSha256Invoice(input);
  const info = await bridgeInfo();
  const dir = info.dirs.toSHA256;
  if (!info.open || !dir.open) throw new Error('XBT to SHA256 swaps are temporarily unavailable.');
  // Limits are quoted in the source-chain payment units. Validate pay_sat below,
  // not the original SHA256 invoice amount (different currencies).
  const challenge = await json('/api/pow');
  const nonce = await solveBridgePow(challenge.challenge, original.hash, challenge.bits);
  const quote = await json('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice: original.invoice, pow: { challenge: challenge.challenge, nonce } }),
  });
  const holdInvoice = quote.hold_invoice;
  const token = quote.token;
  if (typeof holdInvoice !== 'string' || !INVOICE.test(holdInvoice) || holdInvoice.length > MAX_INVOICE_LENGTH ||
      typeof token !== 'string' || !token || token.length > 1024) {
    throw new Error('Invalid bridge hold invoice or settlement token.');
  }
  // Bridge documentation describes expires_at in Unix seconds. Reject ambiguous timestamps.
  const expiresAt = Number(quote.expires_at) * 1000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() + 5000 || expiresAt > Date.now() + 10 * 60 * 1000) {
    throw new Error('Bridge quote is expired or has an invalid deadline.');
  }
  const paySats = sats(quote.pay_sat);
  if (paySats < dir.min_sat || paySats > dir.max_sat) throw new Error('Quoted XBT amount exceeds bridge limits.');
  const hold = parseSha256Invoice(holdInvoice);
  if (hold.sats !== paySats) throw new Error('Bridge payment amount does not match its invoice.');
  // Do not assume the provider uses the same hash across both networks.
  // Atomicity must be independently reviewed before enabling actual payment.
  return {
    originalInvoice: original.invoice,
    originalHash: original.hash,
    originalSats: original.sats,
    holdInvoice,
    paySats,
    expiresAt,
    token,
    rate: dir.rate,
    spread: dir.spread,
  };
}
