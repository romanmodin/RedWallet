// Proof-checked Electrum lookup. RPC transport and an independently established
// chain anchor must be supplied; a server cannot anchor its own alleged header.
// Merkle inclusion is proven. Unspent status still relies on the selected server.
import { crypto, Transaction } from 'bitcoinjs-lib';
import { sats } from './fees';
import { BlockHeader, hashHex, uint32 } from './spv';

export type ChainAnchor = Readonly<{
  height: number;
  hash: string;
  // Must resolve the hash on the independently validated chain view at this tip.
  hashAt(height: number): Promise<string>;
}>;
export type ChainUtxo = Readonly<{
  txid: string;
  vout: number;
  value: number;
  scriptPubKey: string;
  height: number;
  confirmations: number;
  blockTime: number;
  blockHash: string;
  confirmationProof: 'anchored-merkle-pow';
  unspentSource: 'electrum';
}>;
export interface ChainLookup {
  height(): Promise<number>;
  utxo(txid: string, vout: number, scriptPubKey?: string): Promise<ChainUtxo | null>;
}
export type ElectrumRpc = (method: string, params: readonly (number | string | boolean)[]) => Promise<unknown>;
function scriptHex(value: unknown): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 20000 || !/^(?:[0-9a-fA-F]{2})+$/.test(value))
    throw new Error('Invalid output script');
  return value.toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Electrum response');
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Invalid Electrum integer');
  return uint32(value);
}
export class SpvChainLookup implements ChainLookup {
  private readonly tip: Readonly<{ height: number; hash: string }>;
  private readonly hashAt: (height: number) => Promise<string>;
  constructor(
    private readonly rpc: ElectrumRpc,
    anchor: ChainAnchor,
  ) {
    this.tip = Object.freeze({ height: uint32(anchor.height), hash: hashHex(anchor.hash) });
    this.hashAt = anchor.hashAt.bind(anchor);
  }

  async height(): Promise<number> {
    await this.checkTip();
    return this.tip.height;
  }

  private async checkTip(): Promise<void> {
    const result = object(await this.rpc('blockchain.headers.subscribe', []));
    const h = BlockHeader.parse(result.hex as string);
    if (integer(result.height) !== this.tip.height || h.hash !== this.tip.hash || !h.meetsTarget())
      throw new Error('Electrum chain tip changed or does not match anchor');
    if (h.height !== null && h.height !== this.tip.height) throw new Error('Header height mismatch');
  }

  async utxo(txid: string, vout: number, scriptPubKey?: string): Promise<ChainUtxo | null> {
    const id = hashHex(txid),
      index = uint32(vout),
      expected = scriptPubKey === undefined ? undefined : scriptHex(scriptPubKey);
    await this.checkTip();
    // Always derive amount and script from a transaction whose txid we recompute.
    const raw = await this.rpc('blockchain.transaction.get', [id, false]);
    if (typeof raw !== 'string' || raw.length > 2_000_000 || !/^(?:[0-9a-fA-F]{2})+$/.test(raw)) throw new Error('Invalid raw transaction');
    const tx = Transaction.fromHex(raw);
    if (tx.getId() !== id) throw new Error('Transaction ID mismatch');
    const output = tx.outs[index];
    if (!output) return null;
    const spk = scriptHex(Buffer.from(output.script).toString('hex'));
    if (expected !== undefined && spk !== expected) return null;
    const scriptHash = Buffer.from(crypto.sha256(Buffer.from(spk, 'hex')))
      .reverse()
      .toString('hex');
    const entries = await this.rpc('blockchain.scripthash.listunspent', [scriptHash]);
    if (!Array.isArray(entries) || entries.length > 100000) throw new Error('Invalid unspent response');
    const matches = entries.filter(item => {
      const e = object(item);
      return hashHex(e.tx_hash) === id && integer(e.tx_pos) === index;
    });
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new Error('Duplicate unspent output');
    const entry = object(matches[0]),
      height = integer(entry.height);
    if (height === 0 || height > this.tip.height) throw new Error('Output is not confirmed at anchored tip');
    const value = sats(Number(output.value));
    if (typeof entry.value !== 'number' || sats(entry.value) !== value) throw new Error('Unspent amount mismatch');
    const header = BlockHeader.parse((await this.rpc('blockchain.block.header', [height])) as string);
    if (header.height !== null && header.height !== height) throw new Error('Header height mismatch');
    if (!header.meetsTarget() || header.hash !== hashHex(await this.hashAt(height))) throw new Error('Unanchored proof of work');
    const merkle = object(await this.rpc('blockchain.transaction.get_merkle', [id, height]));
    if (
      integer(merkle.block_height) !== height ||
      !Array.isArray(merkle.merkle) ||
      !header.includes(id, merkle.merkle as string[], integer(merkle.pos))
    )
      throw new Error('Invalid transaction inclusion proof');
    await this.checkTip();
    return Object.freeze({
      txid: id,
      vout: index,
      value,
      scriptPubKey: spk,
      height,
      confirmations: this.tip.height - height + 1,
      blockTime: header.time,
      blockHash: header.hash,
      confirmationProof: 'anchored-merkle-pow',
      unspentSource: 'electrum',
    });
  }
}
