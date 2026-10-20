/** Kilojoin v3/v4 wire helpers; adapted from Kilombino (Apache-2.0). */
import { hex, mac, utf8Hash, verifyEvent, NostrEvent } from './crypto';
import { publicKey } from './blind-rsa';
import { Coin, outpoint } from './transaction';
// Experimental participation is opt-in in the main app; each join also requires explicit acknowledgment.
export const LIVE_JOIN_ENABLED = true;
export const PROTOCOL_VERSION = 3;
export const V4_ENABLED = true; // Experimental opt-in; release requires exact-source native qualification.
export const RELAY = 'wss://relay.kilombino.com';
export type Terms = {
  v: 3 | 4;
  outputs?: number;
  app: string;
  network: 'blake2b';
  id: string;
  public_key: string;
  denomination: number;
  fee_rate: number;
  min_peers: number;
  max_peers: number;
  private: boolean;
  timeout: number;
  state: string;
  peers: number;
  script: 'p2wpkh' | 'p2tr';
  max_inputs: number;
  creator: string;
  blind_key: string;
};
function integer(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
}
/** v4 stays hidden from live discovery until multi-output native qualification. */
export function outputCount(terms: Pick<Terms, 'v' | 'outputs'>): number {
  if (terms.v === 3 && (terms.outputs === undefined || terms.outputs === 1)) return 1;
  if (terms.v === 4 && integer(terms.outputs, 2, 5)) return terms.outputs!;
  throw new Error('Invalid protocol output count');
}

export function parsePool(event: NostrEvent, now: number, allowV4 = V4_ENABLED): Readonly<Terms> {
  if (
    !integer(now, 0, Number.MAX_SAFE_INTEGER) ||
    !verifyEvent(event) ||
    event.kind !== 32022 ||
    event.created_at > now + 60 ||
    event.created_at < now - 2100
  )
    throw new Error('Invalid or stale pool event');
  const t = JSON.parse(event.content) as Terms;
  if (
    !t ||
    (t.v !== 3 && !(allowV4 && t.v === 4)) ||
    t.network !== 'blake2b' ||
    t.app !== 'kilowallet' ||
    typeof t.id !== 'string' ||
    !/^[0-9a-f]{16,64}$/.test(t.id)
  )
    throw new Error('Unsupported pool');
  outputCount(t);
  hex(t.public_key, 32);
  hex(t.creator, 32);
  if (
    event.pubkey !== t.public_key ||
    t.creator === t.public_key ||
    event.tags.filter(x => x[0] === 'd').length !== 1 ||
    event.tags.find(x => x[0] === 'd')?.[1] !== t.id ||
    !event.tags.some(x => x[0] === 't' && x[1] === 'kilojoin')
  )
    throw new Error('Pool identity mismatch');
  if (
    !integer(t.denomination, 10000, 100000000) ||
    !integer(t.min_peers, 2, 20) ||
    !integer(t.max_peers, t.min_peers, 20) ||
    !integer(t.peers, 0, t.max_peers) ||
    !integer(t.max_inputs, 1, 10) ||
    !integer(t.timeout, now + 1, Number.MAX_SAFE_INTEGER) ||
    !Number.isFinite(t.fee_rate) ||
    t.fee_rate < 1 ||
    t.fee_rate > 500 ||
    typeof t.private !== 'boolean' ||
    t.state !== 'open' ||
    !['p2wpkh', 'p2tr'].includes(t.script)
  )
    throw new Error('Invalid pool terms');
  publicKey(t.blind_key);
  return Object.freeze({ ...t });
}
export const passwordKey = (pool: string, password: string): Buffer => utf8Hash(`kilojoin/v1/pw|${pool}|${password}`);
export const passwordProof = (key: Uint8Array, join: string): string => mac(key, Buffer.from(join)).toString('hex');
export const tokenHash = (token: string): string => utf8Hash(`kilojoin/v1/token|${token}`).toString('hex');
export const memberMac = (token: string, ...parts: (string | number | boolean)[]): string =>
  mac(Buffer.from(token), Buffer.from('kilojoin/v3|' + parts.join('|'))).toString('hex');
export function changeMessage(pool: string, coins: Coin[], script: string, value: number): Buffer {
  if (!coins.length) throw new Error('No change coins');
  return utf8Hash(`kilojoin/v${coins.length === 1 ? 1 : 2}/change|${pool}|${coins.map(outpoint).join(',')}|${script}|${value}`);
}
