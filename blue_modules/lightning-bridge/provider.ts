import { sha256 } from '@noble/hashes/sha256';
import { Platform } from 'react-native';
import { BridgeHttpError, BridgeHttpReason } from './history';
import { BridgeRequest, nativeBridgeRequest } from './http';
import { BridgeInvoice, ceilSats, hashPattern, readBridgeInvoice } from './invoice';

export type BridgeMarket = {
  open: boolean;
  rate: number;
  spread: number;
  minSat: number;
  maxSat: number;
};
export type BridgeQuote = {
  provider: string;
  hash: string;
  original: string;
  originalMsat: string;
  holdInvoice: string;
  payMsat: string;
  paySat: string;
  rate: number;
  spread: number;
  expiresAt: number;
  token: string;
  destination: string;
  cltv: number;
};
export type BridgeSwap = { state: string; preimage: string };
export interface LightningBridgeProvider {
  readonly id: string;
  readonly name: string;
  readonly website: string;
  readonly node: string;
  info(signal: AbortSignal): Promise<BridgeMarket>;
  quote(invoice: BridgeInvoice, signal: AbortSignal): Promise<BridgeQuote>;
  swap(hash: string, token: string, signal: AbortSignal): Promise<BridgeSwap>;
}
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bridge response.');
  return value as Record<string, unknown>;
};
export function parseMarket(value: unknown): BridgeMarket {
  const direction = object(object(object(value).dirs).toSHA256);
  const { open, rate, spread, min_sat: minSat, max_sat: maxSat } = direction;
  if (
    typeof open !== 'boolean' ||
    !number(rate) ||
    rate <= 0 ||
    !number(spread) ||
    spread < 0 ||
    !number(minSat) ||
    !Number.isSafeInteger(minSat) ||
    minSat < 0 ||
    !number(maxSat) ||
    !Number.isSafeInteger(maxSat) ||
    maxSat < minSat
  ) {
    throw new Error('Invalid bridge availability or pricing.');
  }
  return { open, rate, spread, minSat, maxSat };
}
// Decimal arithmetic binds the displayed rate/spread to the signed invoice amount.
function fraction(value: number): [bigint, bigint] {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid bridge price.');
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const [whole, tail = ''] = mantissa.split('.');
  const shift = Number(exponent) - tail.length;
  const n = BigInt(whole + tail);
  return shift >= 0 ? [n * 10n ** BigInt(shift), 1n] : [n, 10n ** BigInt(-shift)];
}
export function priceMsat(out: string, rate: number, spread: number): bigint {
  const [r, rd] = fraction(rate),
    [s, sd] = fraction(spread);
  if (r === 0n) throw new Error('Invalid exchange rate.');
  const numerator = BigInt(out) * rd * (sd + s),
    denominator = r * sd;
  return (numerator + denominator - 1n) / denominator;
}
export function validateQuote(
  value: unknown,
  original: BridgeInvoice,
  provider: Pick<LightningBridgeProvider, 'id' | 'node'>,
  now = Date.now(),
): BridgeQuote {
  const q = object(value);
  if (original.chain !== 'SHA256' || original.expiresAt * 1000 <= now)
    throw new Error('Original invoice expired or is for the wrong chain.');
  if (
    q.dir !== 'toSHA256' ||
    q.hash !== original.hash ||
    typeof q.hold_invoice !== 'string' ||
    typeof q.token !== 'string' ||
    !/^[0-9a-f]{32}$/.test(q.token) ||
    !number(q.pay_sat) ||
    !Number.isSafeInteger(q.pay_sat) ||
    q.pay_sat <= 0 ||
    !number(q.rate) ||
    q.rate <= 0 ||
    !number(q.spread) ||
    q.spread < 0 ||
    !number(q.sat) ||
    q.sat !== Number(original.msat) / 1000 ||
    !number(q.expires_at) ||
    !Number.isSafeInteger(q.expires_at)
  )
    throw new Error('Bridge quote does not match the requested payment.');
  const hold = readBridgeInvoice(q.hold_invoice);
  const expected = priceMsat(original.msat, q.rate, q.spread);
  const difference = BigInt(hold.msat) - expected;
  if (
    hold.chain !== 'XBT' ||
    hold.hash !== original.hash ||
    hold.destination !== provider.node ||
    q.node !== provider.node ||
    ceilSats(hold.msat) !== String(q.pay_sat) ||
    difference < -1n ||
    difference > 1n ||
    hold.cltv > 2016 ||
    q.cltv !== hold.cltv ||
    q.expires_at > hold.expiresAt ||
    Math.min(q.expires_at, hold.expiresAt, original.expiresAt) * 1000 - now < 15000
  ) {
    throw new Error('Unsafe bridge invoice, price, destination or expiration.');
  }
  return {
    provider: provider.id,
    hash: original.hash,
    original: original.invoice,
    originalMsat: original.msat,
    holdInvoice: hold.invoice,
    payMsat: hold.msat,
    paySat: String(q.pay_sat),
    rate: q.rate,
    spread: q.spread,
    expiresAt: Math.min(q.expires_at, original.expiresAt),
    token: q.token,
    destination: hold.destination,
    cltv: hold.cltv,
  };
}
export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (!byte) bits += 8;
    else {
      bits += Math.clz32(byte) - 24;
      break;
    }
  }
  return bits;
}
export class ProofTimeoutError extends Error {
  constructor() {
    super('Proof of work timed out before the quote request. No payment was sent. You can request a new quote.');
  }
}
export class QuoteResponseTimeoutError extends Error {
  constructor() {
    super(
      'Quote response timed out. The processor may have reserved this invoice. No payment was submitted. Wait for the reservation to expire before trying again.',
    );
  }
}
const bridgeRequestTimeoutMs = 15000;
export const bridgeQuoteResponseTimeoutMs = 60000;

export async function solveProof(
  value: unknown,
  hash: string,
  signal: AbortSignal,
  now = () => Date.now(),
): Promise<{ challenge: string; nonce: string }> {
  const { challenge, bits, ttl_s: ttl = 120 } = object(value);
  if (
    typeof challenge !== 'string' ||
    challenge.length < 1 ||
    challenge.length > 200 ||
    !number(bits) ||
    !Number.isInteger(bits) ||
    bits < 0 ||
    bits > 256 ||
    !hashPattern.test(hash) ||
    !number(ttl) ||
    ttl <= 0
  )
    throw new Error('Invalid bridge proof-of-work challenge.');
  const start = now();
  const deadline = start + Math.min(ttl * 1000, 120000);
  let yieldAt = start + 8;
  const prefix = sha256.create().update(Buffer.from(challenge + ':' + hash + ':'));
  for (let nonce = 0; Number.isSafeInteger(nonce); nonce++) {
    if (nonce % 64 === 0) {
      if (now() >= yieldAt) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        yieldAt = now() + 8;
      }
      if (signal.aborted) throw new Error('Quote canceled.');
      if (now() >= deadline) throw new ProofTimeoutError();
    }
    const text = nonce.toString(36);
    if (leadingZeroBits(prefix.clone().update(text).digest()) >= bits) {
      if (now() >= deadline) throw new ProofTimeoutError();
      return { challenge, nonce: text };
    }
  }
  throw new Error('Proof of work exhausted.');
}

abstract class HoldInvoiceProvider implements LightningBridgeProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly website: string;
  abstract readonly node: string;
  abstract info(signal: AbortSignal): Promise<BridgeMarket>;
  abstract quote(invoice: BridgeInvoice, signal: AbortSignal): Promise<BridgeQuote>;
  private readonly request: BridgeRequest;
  constructor(request: BridgeRequest = nativeBridgeRequest) {
    this.request = request;
  }

  protected async call(reason: BridgeHttpReason, path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const isQuoteRequest = path === '/api/quote' && body !== undefined;
    let timedOut = false;
    signal.addEventListener('abort', abort);
    const timer = setTimeout(
      () => {
        timedOut = true;
        abort();
      },
      isQuoteRequest ? bridgeQuoteResponseTimeoutMs : bridgeRequestTimeoutMs,
    );
    try {
      if (signal.aborted) throw new Error('Quote canceled.');
      const response = await this.request(this.website + path, {
        method: body ? 'POST' : 'GET',
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RedWallet',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error('Bridge quote limit reached. Wait before requesting another quote.');
        throw new BridgeHttpError(reason, response.status);
      }
      if (response.url && !response.url.startsWith(this.website + '/')) throw new Error('Bridge redirected to another service.');
      const text = await response.text();
      if (text.length > 32768) throw new Error('Oversized bridge response.');
      return JSON.parse(text);
    } catch (error) {
      if (timedOut && !signal.aborted && isQuoteRequest) throw new QuoteResponseTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async swap(hash: string, token: string, signal: AbortSignal): Promise<BridgeSwap> {
    if (!hashPattern.test(hash) || (token && !/^[0-9a-f]{32}$/.test(token))) throw new Error('Invalid swap reference.');
    const data = object(await this.call('statusHttp', '/api/swap/' + hash + '?t=' + encodeURIComponent(token), signal));
    if (typeof data.state !== 'string' || typeof data.preimage !== 'string') throw new Error('Invalid bridge status.');
    return { state: data.state, preimage: data.preimage };
  }
}
export class KilombinoProvider extends HoldInvoiceProvider {
  readonly id = 'kilombino';
  readonly name = 'Kilombino';
  readonly website = 'https://bridge.kilombino.com';
  // Kilowallet Lightning.KILOMBINO_NODE, source e368766168dff16ea2302cd5ced8860dc019b3ef.
  readonly node = '0222d36d7b634ead665c982145f6e4507ad65c4f369902ab3ca11e379d2139dc60';

  async info(signal: AbortSignal): Promise<BridgeMarket> {
    return parseMarket(await this.call('marketHttp', '/api/info', signal));
  }

  async quote(invoice: BridgeInvoice, signal: AbortSignal): Promise<BridgeQuote> {
    const pow = await solveProof(await this.call('proofHttp', '/api/pow', signal), invoice.hash, signal);
    return validateQuote(await this.call('quoteHttp', '/api/quote', signal, { invoice: invoice.invoice, pow }), invoice, this);
  }

}

function isPaperclipToSha256(response: Record<string, unknown>): boolean {
  return response.direction === 'toSHA256' && (response.dir === undefined || response.dir === response.direction);
}

export class PaperclipProvider extends HoldInvoiceProvider {
  readonly id = 'paperclip';
  readonly name = 'Connor’s Lab / Paperclip';
  readonly website = 'https://lightning.paperclip-xbt.xyz/bridge';
  readonly node = '03c56897a97beb0d86e89494e5a9938939bb52b303eb714b0df7219108ee92b178';

  async info(signal: AbortSignal): Promise<BridgeMarket> {
    const info = object(await this.call('marketHttp', '/api/info?direction=toSHA256', signal));
    if (!isPaperclipToSha256(info) || info.cap_unit !== 'SHA256 sats') throw new Error('Unexpected Paperclip market.');
    return parseMarket({ dirs: { toSHA256: { ...info, open: info.open === true && info.payments_enabled === true } } });
  }

  async quote(invoice: BridgeInvoice, signal: AbortSignal): Promise<BridgeQuote> {
    if (invoice.chain !== 'SHA256' || invoice.expiresAt * 1000 <= Date.now()) throw new Error('Invalid Paperclip recipient invoice.');
    const body = { invoice: invoice.invoice, direction: 'toSHA256' };
    const preview = object(await this.call('previewHttp', '/api/check', signal, body));
    if (typeof preview.wait_s === 'number' && Number.isSafeInteger(preview.wait_s) && preview.wait_s > 0)
      throw new Error(`Paperclip asks you to wait ${preview.wait_s} seconds before requesting another quote.`);
    if (preview.error) throw new Error('Paperclip declined the invoice preview.');
    if (preview.wait_s) throw new Error('Paperclip returned an unexpected retry interval.');
    if (!isPaperclipToSha256(preview)) throw new Error('Paperclip could not confirm the payment direction.');
    if (preview.hash !== invoice.hash) throw new Error('Paperclip could not confirm the invoice payment hash.');
    if (preview.sat !== Number(invoice.msat) / 1000) throw new Error('Paperclip could not confirm the invoice amount.');
    const pow = await solveProof(await this.call('proofHttp', '/api/pow', signal), invoice.hash, signal);
    const quote = object(await this.call('quoteHttp', '/api/quote', signal, { ...body, pow }));
    if (!isPaperclipToSha256(quote)) throw new Error('Unexpected Paperclip quote direction.');
    return validateQuote({ ...quote, dir: quote.direction }, invoice, this);
  }
}
// Only implemented providers appear in the processor picker. No automatic fallback.
export const lightningBridgeProviders: readonly LightningBridgeProvider[] = Platform.OS === 'ios'
  ? [new KilombinoProvider(), new PaperclipProvider()]
  : [new KilombinoProvider()];
