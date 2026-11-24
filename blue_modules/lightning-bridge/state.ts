import { BridgeInvoice, ceilSats, hashPattern, nodePattern, provesPayment, readBridgeInvoice } from './invoice';
import { BridgeQuote, LightningBridgeProvider, ProofTimeoutError, validateQuote } from './provider';

export type SwapState =
  | 'requesting'
  | 'quote_failed'
  | 'quoted'
  | 'canceled'
  | 'quote_expired'
  | 'submitting'
  | 'pending'
  | 'unknown'
  | 'settled'
  | 'failed';
export type SwapRecord = {
  hash: string;
  node: string;
  provider: string;
  state: SwapState;
  createdAt: number;
  updatedAt: number;
  quote?: BridgeQuote;
  feeLimit: string;
  proofTimedOut?: true;
  estimatedFeeMsat?: string;
  actualFeeMsat?: string;
  bridgeState?: string;
};
export type BridgeJournal = {
  version: 1;
  records: SwapRecord[];
  requests: number[];
};
export interface BridgeStore {
  read(): Promise<BridgeJournal>;
  write(journal: BridgeJournal): Promise<void>;
}
export type NodePayment = {
  state: 'not_found' | 'not_submitted' | 'pending' | 'unknown' | 'settled' | 'failed';
  proofVerified?: boolean;
  msat?: string;
  feeMsat?: string;
};
export interface BridgeBackend {
  identity(): Promise<string>;
  review(record: SwapRecord): Promise<{ estimatedFeeMsat?: string }>;
  status(hash: string): Promise<NodePayment>;
  pay(record: SwapRecord): Promise<NodePayment>;
}
const unresolved = new Set<SwapState>(['submitting', 'pending', 'unknown']);
const disposableQuotes = new Set<SwapState>(['requesting', 'quoted', 'quote_failed', 'canceled', 'quote_expired']);
function reservationEnds(record: SwapRecord): number {
  if (record.state === 'quote_failed' && !record.quote && record.proofTimedOut === true) return record.updatedAt;
  return record.quote ? record.quote.expiresAt * 1000 + 60000 : record.createdAt + 600000;
}
const validState = new Set<SwapState>([
  'requesting',
  'quote_failed',
  'quoted',
  'canceled',
  'quote_expired',
  'submitting',
  'pending',
  'unknown',
  'settled',
  'failed',
]);
const validAmount = (v: unknown) => typeof v === 'string' && /^[0-9]+$/.test(v) && BigInt(v) <= 2100000000000000000n;
export function validateJournal(value: unknown): BridgeJournal {
  const data = value as BridgeJournal;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.records) ||
    data.records.length > 200 ||
    !Array.isArray(data.requests) ||
    data.requests.length > 6 ||
    data.requests.some(x => !Number.isSafeInteger(x) || x < 0)
  )
    throw new Error('Bridge payment storage is unavailable.');
  const seen = new Set<string>();
  for (const r of data.records) {
    const key = r.node + ':' + r.hash;
    if (
      !r ||
      !hashPattern.test(r.hash) ||
      !nodePattern.test(r.node) ||
      !validState.has(r.state) ||
      typeof r.provider !== 'string' ||
      !validAmount(r.feeLimit) ||
      BigInt(r.feeLimit) < 1n ||
      !Number.isSafeInteger(r.createdAt) ||
      !Number.isSafeInteger(r.updatedAt) ||
      seen.has(key)
    )
      throw new Error('Bridge payment storage is invalid.');
    seen.add(key);
    if (
      (r.estimatedFeeMsat !== undefined && !validAmount(r.estimatedFeeMsat)) ||
      (r.actualFeeMsat !== undefined && !validAmount(r.actualFeeMsat))
    )
      throw new Error('Invalid stored payment fees.');
    if (r.quote) {
      const q = r.quote,
        original = readBridgeInvoice(q.original),
        hold = readBridgeInvoice(q.holdInvoice);
      if (
        !Number.isFinite(q.rate) ||
        q.rate <= 0 ||
        !Number.isFinite(q.spread) ||
        q.spread < 0 ||
        q.cltv !== hold.cltv ||
        q.cltv > 2016 ||
        q.paySat !== ceilSats(hold.msat) ||
        q.expiresAt <= 0 ||
        q.expiresAt > Math.min(original.expiresAt, hold.expiresAt) ||
        (q.token !== '' && !/^[0-9a-f]{32}$/.test(q.token))
      )
        throw new Error('Invalid stored quote.');
      if (
        q.hash !== r.hash ||
        q.provider !== r.provider ||
        original.hash !== r.hash ||
        hold.hash !== r.hash ||
        original.chain !== 'SHA256' ||
        hold.chain !== 'XBT' ||
        original.msat !== q.originalMsat ||
        hold.msat !== q.payMsat ||
        hold.destination !== q.destination ||
        !Number.isSafeInteger(q.expiresAt) ||
        typeof q.token !== 'string'
      )
        throw new Error('Bridge payment storage is invalid.');
    } else if (r.state !== 'requesting' && r.state !== 'quote_failed') throw new Error('Missing stored payment.');
  }
  return data;
}
// Warm signature results in bounded batches after a cold launch. The validation
// pass below then checks every stored field using cached immutable decodes.
export async function validateJournalAsync(value: unknown): Promise<BridgeJournal> {
  const data = value as BridgeJournal;
  if (!data || !Array.isArray(data.records) || data.records.length > 200) throw new Error('Invalid bridge payment storage.');
  for (const record of data.records) {
    if (record?.quote) {
      readBridgeInvoice(record.quote.original);
      readBridgeInvoice(record.quote.holdInvoice);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  return validateJournal(value);
}

// Every provider adapter crosses the same validation boundary before review/payment.
function checkedQuote(q: BridgeQuote, original: BridgeInvoice, provider: LightningBridgeProvider, now: number): BridgeQuote {
  if (q.original !== original.invoice || q.originalMsat !== original.msat || q.provider !== provider.id)
    throw new Error('Quote invoice or processor changed.');
  const checked = validateQuote(
    {
      dir: 'toSHA256',
      hash: q.hash,
      sat: Number(q.originalMsat) / 1000,
      hold_invoice: q.holdInvoice,
      pay_sat: Number(q.paySat),
      rate: q.rate,
      spread: q.spread,
      expires_at: q.expiresAt,
      node: q.destination,
      cltv: q.cltv,
      token: q.token,
    },
    original,
    provider,
    now,
  );
  if (checked.payMsat !== q.payMsat) throw new Error('Quote amount changed.');
  return checked;
}
export class BridgeController {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly store: BridgeStore;
  private readonly backend: BridgeBackend;
  private readonly providers: readonly LightningBridgeProvider[];
  private readonly now: () => number;
  constructor(store: BridgeStore, backend: BridgeBackend, providers: readonly LightningBridgeProvider[], now = () => Date.now()) {
    this.store = store;
    this.backend = backend;
    this.providers = providers;
    this.now = now;
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load() {
    return validateJournal(await this.store.read());
  }

  private provider(id: string) {
    const provider = this.providers.find(p => p.id === id);
    if (!provider) throw new Error('This Lightning processor is unavailable.');
    return provider;
  }

  private async identity() {
    const node = await this.backend.identity();
    if (!nodePattern.test(node)) throw new Error('Could not verify the XBT node identity.');
    return node;
  }

  list(): Promise<SwapRecord[]> {
    return this.exclusive(async () => {
      const node = await this.identity();
      return (await this.load()).records.filter(r => r.node === node);
    });
  }

  async blocksNormalPayment(hash: string): Promise<boolean> {
    return this.exclusive(async () => {
      const node = await this.identity();
      return (await this.load()).records.some(
        r => r.node === node && r.hash === hash && (unresolved.has(r.state) || r.state === 'settled'),
      );
    });
  }

  quote(providerId: string, original: BridgeInvoice, feeLimit: string, signal: AbortSignal): Promise<SwapRecord> {
    return this.exclusive(async () => {
      if (original.chain !== 'SHA256' || original.expiresAt * 1000 <= this.now())
        throw new Error('Original invoice expired or is for the wrong chain.');
      if (!/^[1-9][0-9]*$/.test(feeLimit) || BigInt(feeLimit) > 2100000000000000n) throw new Error('Choose a positive routing fee limit.');
      const provider = this.provider(providerId),
        node = await this.identity(),
        journal = await this.load();
      const existing = journal.records.find(r => r.hash === original.hash && r.node === node);
      if (existing && (unresolved.has(existing.state) || existing.state === 'settled'))
        throw new Error('This payment is pending, uncertain or already paid. Check its status; do not pay again.');
      if (existing && this.now() < reservationEnds(existing))
        throw new Error('A quote for this invoice already exists. Wait before requesting another.');
      const previous = await this.backend.status(original.hash);
      if (!['not_found', 'failed'].includes(previous.state))
        throw new Error('LND already knows this payment. Check its status before proceeding.');
      journal.requests = journal.requests.filter(t => this.now() - t < 600000);
      if (journal.requests.length >= 6) throw new Error('Six quote requests per ten minutes. Please wait.');
      let replaced = existing;
      if (!existing && journal.records.length >= 200) {
        replaced = journal.records
          .filter(record => disposableQuotes.has(record.state) && reservationEnds(record) <= this.now())
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!replaced) throw new Error('Bridge payment history is full. No new payment was created.');
      }
      if (signal.aborted) throw new Error('Quote canceled.');
      const market = await provider.info(signal);
      if (!market.open) throw new Error('This processor is unavailable for XBT → SHA256.');
      if (BigInt(original.msat) < BigInt(market.minSat) * 1000n || BigInt(original.msat) > BigInt(market.maxSat) * 1000n)
        throw new Error('Invoice amount is outside the processor limits.');
      const record: SwapRecord = {
        hash: original.hash,
        node,
        provider: providerId,
        state: 'requesting',
        createdAt: this.now(),
        updatedAt: this.now(),
        feeLimit,
      };
      journal.records = journal.records.filter(r => r !== replaced);
      journal.records.push(record);
      journal.requests.push(this.now());
      // Persist the reservation before the quote request. A crash cannot silently bypass the limit.
      await this.store.write(journal);
      try {
        record.quote = checkedQuote(await provider.quote(original, signal), original, provider, this.now());
        if (signal.aborted) throw new Error('Quote canceled.');
        if (record.quote.provider !== providerId || record.quote.hash !== original.hash) throw new Error('Wrong processor quote.');
        const review = await this.backend.review(record);
        if (review.estimatedFeeMsat !== undefined) {
          if (!validAmount(review.estimatedFeeMsat)) throw new Error('Invalid routing fee estimate.');
          record.estimatedFeeMsat = review.estimatedFeeMsat;
        }
        record.state = signal.aborted ? 'canceled' : 'quoted';
      } catch (error) {
        if (error instanceof ProofTimeoutError && !record.quote) record.proofTimedOut = true;
        record.state = record.quote ? 'canceled' : 'quote_failed';
        record.updatedAt = this.now();
        await this.store.write(journal);
        throw error;
      }
      record.updatedAt = this.now();
      await this.store.write(journal);
      return JSON.parse(JSON.stringify(record));
    });
  }

  cancel(hash: string): Promise<void> {
    return this.exclusive(async () => {
      const node = await this.identity(),
        journal = await this.load(),
        r = journal.records.find(x => x.hash === hash && x.node === node);
      if (!r || r.state !== 'quoted') return;
      r.state = 'canceled';
      r.updatedAt = this.now();
      if (r.quote) r.quote.token = '';
      await this.store.write(journal);
    });
  }

  approve(hash: string, expectedQuote: string, canSubmit: () => boolean): Promise<SwapRecord> {
    return this.exclusive(async () => {
      const node = await this.identity(),
        journal = await this.load(),
        r = journal.records.find(x => x.hash === hash && x.node === node);
      if (!r || r.state !== 'quoted' || !r.quote || r.quote.holdInvoice !== expectedQuote)
        throw new Error('Review this quote again before paying.');
      if (r.quote.expiresAt * 1000 - this.now() < 15000 || readBridgeInvoice(r.quote.original).expiresAt * 1000 - this.now() < 15000) {
        r.state = 'quote_expired';
        await this.store.write(journal);
        throw new Error('Quote expired. Nothing was sent.');
      }
      r.quote = checkedQuote(r.quote, readBridgeInvoice(r.quote.original), this.provider(r.provider), this.now());
      const state = await this.backend.status(hash);
      if (state.state !== 'not_found' && state.state !== 'failed') throw new Error('Payment already exists or its result is unknown.');
      await this.backend.review(r);
      if (!canSubmit()) throw new Error('Action canceled. Nothing was submitted.');
      if (r.quote.expiresAt * 1000 - this.now() < 15000) throw new Error('Quote expired. Nothing was sent.');
      r.state = 'submitting';
      r.updatedAt = this.now();
      await this.store.write(journal);
      // From this durable boundary onward, interruption is ambiguous. Never retry.
      try {
        if (!canSubmit()) this.applyNode(r, { state: 'not_submitted' });
        else this.applyNode(r, await this.backend.pay(r));
      } catch {
        r.state = 'unknown';
      }
      r.updatedAt = this.now();
      await this.store.write(journal);
      return JSON.parse(JSON.stringify(r));
    });
  }

  private applyNode(r: SwapRecord, result: NodePayment) {
    if (result.state === 'settled') {
      if (
        !r.quote ||
        result.proofVerified !== true ||
        result.msat !== r.quote.payMsat ||
        !validAmount(result.feeMsat) ||
        BigInt(result.feeMsat!) > BigInt(r.feeLimit) * 1000n
      ) {
        r.state = 'unknown';
        return;
      }
      r.state = 'settled';
      r.actualFeeMsat = result.feeMsat;
      r.quote.token = '';
    } else if (result.state === 'not_submitted') {
      r.state = 'canceled';
      if (r.quote) r.quote.token = '';
    } else if (result.state === 'failed') {
      r.state = 'failed';
      if (r.quote) r.quote.token = '';
    } else if (result.state === 'pending') r.state = 'pending';
    else r.state = 'unknown'; // Missing history after submission never authorizes a retry.
  }

  refresh(hash: string, signal: AbortSignal): Promise<SwapRecord> {
    return this.exclusive(async () => {
      const node = await this.identity(),
        journal = await this.load(),
        r = journal.records.find(x => x.hash === hash && x.node === node);
      if (!r) throw new Error('Saved swap not found for this XBT node.');
      if (unresolved.has(r.state)) {
        try {
          this.applyNode(r, await this.backend.status(hash));
        } catch {
          /* Keep the durable uncertain state. */
        }
        if (r.quote && unresolved.has(r.state)) {
          try {
            const remote = await this.provider(r.provider).swap(hash, r.quote.token, signal);
            if ((remote.state === 'settled' || remote.preimage !== '') && !provesPayment(remote.preimage, hash)) {
              throw new Error('Invalid bridge payment proof.');
            }
            // Remote terminal state alone never establishes local settlement or released HTLCs.
            r.bridgeState = remote.state;
          } catch {
            /* Local node remains authoritative; never resend. */
          }
        }
      } else if (r.state === 'quoted' && r.quote!.expiresAt * 1000 <= this.now()) r.state = 'quote_expired';
      r.updatedAt = this.now();
      await this.store.write(journal);
      return JSON.parse(JSON.stringify(r));
    });
  }
}
