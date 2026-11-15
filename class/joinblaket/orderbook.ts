// Read-only orderbook watch, adapted from pinned rc6 Orderbook.kt (Apache-2.0).
// Certificates are verified here; chain verification/valuation remains mandatory before selection.
import type { DirectoryClient } from './directory';
import { BondedOffer, parseOrderbook } from './offers';
import { isValidNick } from './nick';
import { Frame, PRIVMSG, PUBMSG } from './wire';

type Client = Pick<DirectoryClient, 'authenticated' | 'nick' | 'getPeerlist' | 'sendPublic' | 'receive' | 'close'>;
type Options = Readonly<{
  minWaitMs?: number;
  quietMs?: number;
  maxWaitMs?: number;
  maxMessages?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  now?: () => number;
}>;
export type OrderbookResult = Readonly<{
  offers: readonly BondedOffer[];
  heard: number;
  dropped: number;
  truncated: boolean;
}>;
const active = new WeakSet<Client>();
const prefixes = ['sw0absoffer', 'sw0reloffer', 'swabsoffer', 'swreloffer'];
function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid orderbook limit');
  return value;
}

/**
 * GETPEERLIST followed by exactly one PUBLIC "orderbook" request. No fill, proof,
 * wallet input or signature is disclosed. Caller owns the connected client.
 * Valid certificates are deduplicated incrementally rather than storing 32 MiB
 * of raw traffic. Limits fail closed to a visibly truncated result, not a claim
 * that all makers have been discovered. This is not a chain-verified market.
 */
export async function fetchOrderbook(client: Client, options: Options = {}): Promise<OrderbookResult> {
  if (!client.authenticated || !isValidNick(client.nick)) throw new Error('Authenticated directory required');
  if (active.has(client)) throw new Error('Orderbook request already active');
  const maximum = bounded(options.maxWaitMs ?? 120_000, 1, 120_000);
  const minimum = Math.min(bounded(options.minWaitMs ?? 30_000, 0, 120_000), maximum);
  const quiet = Math.min(bounded(options.quietMs ?? 15_000, 0, 120_000), maximum - minimum);
  const maxMessages = bounded(options.maxMessages ?? 10_000, 1, 10_000);
  const maxBytes = bounded(options.maxBytes ?? 32 * 1024 * 1024, 1, 32 * 1024 * 1024);
  const now = options.now ?? (() => performance.now());
  const nick = client.nick,
    signal = options.signal;
  const cancel = () => client.close();
  const check = () => {
    if (signal?.aborted) throw new Error('Orderbook request cancelled');
    if (!client.authenticated || client.nick !== nick) throw new Error('Directory connection changed');
  };
  active.add(client);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) {
      cancel();
      check();
    }
    await client.getPeerlist();
    check();
    await client.sendPublic('orderbook'); // No leading "!" here: the outer wire framing supplies separators.
    check();
    const start = now();
    let lastOffer = start,
      totalBytes = 0,
      messages = 0,
      observed = 0,
      heard = 0,
      truncated = false;
    const offers = new Map<string, BondedOffer>();
    while (true) {
      check();
      const elapsed = now() - start;
      if (elapsed >= maximum || (elapsed >= minimum && quiet > 0 && now() - lastOffer >= quiet)) break;
      const remainingQuiet = quiet > 0 ? Math.max(minimum - elapsed, quiet - (now() - lastOffer)) : maximum - elapsed;
      const frame = await client.receive(Math.max(1, Math.ceil(Math.min(1000, maximum - elapsed, remainingQuiet))));
      check();
      if (!frame) continue;
      if (++observed > 20_000) {
        truncated = true;
        break;
      }
      const snapshot: Frame = { type: frame.type, line: frame.line };
      if (typeof snapshot.line !== 'string' || Buffer.byteLength(snapshot.line, 'utf8') > 65536) throw new Error('Invalid directory frame');
      if ([PRIVMSG, PUBMSG].includes(snapshot.type) && prefixes.some(prefix => snapshot.line.includes(prefix))) {
        lastOffer = now();
        const bytes = Buffer.byteLength(snapshot.line, 'utf8');
        if (messages >= maxMessages || totalBytes + bytes > maxBytes) {
          truncated = true;
          break;
        }
        messages++;
        totalBytes += bytes;
        const parsed = parseOrderbook([snapshot], nick);
        heard += parsed.heard;
        for (const offer of parsed.offers) {
          const key = offer.offer.counterparty + ':' + offer.offer.oid,
            previous = offers.get(key);
          if (!previous || offer.bond.expiry > previous.bond.expiry) offers.set(key, offer);
        }
      }
      // Let cancellation/UI events run even if a hostile peer keeps the native queue full.
      if (observed % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    check();
    return Object.freeze({ offers: Object.freeze([...offers.values()]), heard, dropped: heard - offers.size, truncated });
  } catch {
    client.close();
    throw new Error(signal?.aborted ? 'Orderbook request cancelled' : 'Could not read the authenticated orderbook');
  } finally {
    signal?.removeEventListener('abort', cancel);
    active.delete(client);
  }
}
