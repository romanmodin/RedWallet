import { decode } from 'bolt11';
import { bech32 } from 'bech32';
import { sha256 } from '@noble/hashes/sha256';

export type BridgeInvoice = {
  invoice: string;
  hash: string;
  msat: string;
  destination: string;
  expiresAt: number;
  cltv: number;
  chain: 'XBT' | 'SHA256';
};
export const hashPattern = /^[0-9a-f]{64}$/;
export const nodePattern = /^(02|03)[0-9a-f]{64}$/;

// Both chains use lnbc. Classify only signed feature bits, never the HRP alone.
export function readBridgeInvoice(value: string): BridgeInvoice {
  const invoice = value.trim().replace(/^lightning:/i, '');
  if (invoice.length > 8192 || !/^lnbc[0-9]*[munp]?1/i.test(invoice)) throw new Error('Use a mainnet Lightning invoice.');
  const raw = bech32.decode(invoice, 8192);
  const words = raw.words.slice(0, -104);
  if (words.length < 7) throw new Error('Invalid Lightning invoice.');
  const counts = new Map<number, number>();
  let blake = false;
  for (let i = 7; i < words.length; ) {
    if (i + 3 > words.length) throw new Error('Truncated invoice tag.');
    const tag = words[i],
      size = words[i + 1] * 32 + words[i + 2];
    i += 3;
    if (i + size > words.length) throw new Error('Truncated invoice tag.');
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
    if ([1, 5, 6, 19, 24].includes(tag) && counts.get(tag)! > 1) throw new Error('Ambiguous invoice tags.');
    if (tag === 1 && size !== 52) throw new Error('Invalid payment hash.');
    if (tag === 5) {
      const field = words.slice(i, i + size);
      blake = [512, 513].some(bit => Math.floor((field[field.length - 1 - Math.floor(bit / 5)] ?? 0) / 2 ** (bit % 5)) % 2 === 1);
    }
    i += size;
  }
  // The existing decoder verifies checksum/signature and recovers the signer.
  const decoded = decode(invoice);
  const tag = (name: string) => decoded.tags.find(item => item.tagName === name)?.data;
  const hash = tag('payment_hash');
  const msat = decoded.millisatoshis;
  const expiry = tag('expire_time') ?? 3600;
  const cltv = tag('min_final_cltv_expiry') ?? 18;
  if (
    counts.get(1) !== 1 ||
    typeof hash !== 'string' ||
    !hashPattern.test(hash) ||
    !msat ||
    !/^[1-9][0-9]*$/.test(msat) ||
    BigInt(msat) > 2100000000000000000n ||
    !decoded.payeeNodeKey ||
    !nodePattern.test(decoded.payeeNodeKey) ||
    !Number.isSafeInteger(decoded.timestamp) ||
    typeof expiry !== 'number' ||
    !Number.isSafeInteger(expiry) ||
    expiry < 0 ||
    typeof cltv !== 'number' ||
    !Number.isSafeInteger(cltv) ||
    cltv < 0
  )
    throw new Error('Invalid amount, signature or invoice fields.');
  const expiresAt = decoded.timestamp! + expiry;
  if (!Number.isSafeInteger(expiresAt)) throw new Error('Invalid invoice expiry.');
  return {
    invoice: invoice.toLowerCase(),
    hash,
    msat,
    destination: decoded.payeeNodeKey,
    expiresAt,
    cltv,
    chain: blake ? 'XBT' : 'SHA256',
  };
}
export function provesPayment(preimage: string, hash: string): boolean {
  return hashPattern.test(preimage) && hashPattern.test(hash) && Buffer.from(sha256(Buffer.from(preimage, 'hex'))).toString('hex') === hash;
}
export const ceilSats = (msat: string): string => ((BigInt(msat) + 999n) / 1000n).toString();
export const formatMsat = (msat: string): string => {
  const negative = BigInt(msat) < 0n;
  const amount = negative ? -BigInt(msat) : BigInt(msat);
  const fraction = (amount % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + (amount / 1000n).toString() + (fraction ? '.' + fraction : '');
};
