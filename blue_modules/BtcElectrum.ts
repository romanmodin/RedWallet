import * as bitcoin from 'bitcoinjs-lib';
import type * as XbtElectrum from './BlueElectrum';

const ElectrumClient = require('electrum-client');
const net = require('net');
const tls = require('tls');

/** Bitcoin's first post-XBT-fork block. Genesis is shared and cannot identify the chain.
 * Independently read from Blockstream and mempool.space on 2026-11-08.
 * A checkpoint identifies compatibility, not an authenticated proof of the live chain.
 */
export const BTC_CHECKPOINT_HEIGHT = 961640;
export const BTC_CHECKPOINT_HASH = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';
const peers: { host: string; ssl: number; tcp?: number }[] = [{ host: 'electrum.blockstream.info', ssl: 50002 }];
const REQUEST_TIMEOUT = 15_000;
let selectedWallet: string | undefined;
let foreground = true;
let generation = 0;
let client: any;
let connecting: Promise<boolean> | undefined;
let connected = false;
let tip = 0;
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getConnectionState = (): 'inactive' | 'selected' | 'connected' =>
  !selectedWallet || !foreground ? 'inactive' : connected ? 'connected' : 'selected';
const emit = () => listeners.forEach(listener => listener());
const heights = new Map<string, number>();
const timestamps = new Map<number, number>();

export function isBitcoinCheckpoint(header: unknown): boolean {
  if (typeof header !== 'string' || !/^[0-9a-f]{160}$/i.test(header)) return false;
  return (
    Buffer.from(bitcoin.crypto.hash256(Buffer.from(header, 'hex')))
      .reverse()
      .toString('hex') === BTC_CHECKPOINT_HASH
  );
}

export function forceDisconnect(): void {
  generation++;
  connected = false;
  connecting = undefined;
  const old = client;
  client = undefined;
  try {
    old?.close();
  } catch {}
  tip = 0;
  heights.clear();
  timestamps.clear();
  emit();
}

/** Merely storing/restoring a BTC wallet must never create a connection. */
export function selectWallet(walletID?: string): void {
  if (selectedWallet === walletID) return;
  forceDisconnect();
  selectedWallet = walletID;
  emit();
}

export function setForeground(value: boolean): void {
  foreground = value;
  if (!value) forceDisconnect();
  emit();
}

export const isSelected = (walletID: string): boolean => foreground && selectedWallet === walletID;

function requireSelected(walletID: string): void {
  if (!isSelected(walletID)) throw new Error('Select the blue BTC wallet to connect to Bitcoin.');
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Bitcoin server request timed out')), REQUEST_TIMEOUT);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureConnected(walletID: string, refreshTip = false): Promise<boolean> {
  if (!isSelected(walletID)) return false;
  if (connected && client && !refreshTip) return true;
  if (connected && client) {
    const active = client;
    const epoch = generation;
    try {
      const latest: any = await bounded(active.blockchainHeaders_subscribe());
      if (!isSelected(walletID) || epoch !== generation || active !== client) return false;
      if (!Number.isSafeInteger(latest?.height) || latest.height < BTC_CHECKPOINT_HEIGHT) throw new Error('Invalid Bitcoin chain height');
      tip = latest.height;
      return true;
    } catch {
      if (active === client) forceDisconnect();
      return false;
    }
  }
  if (connecting) return connecting;
  const epoch = generation;
  const attempt = (async () => {
    for (const peer of peers) {
      if (!isSelected(walletID) || epoch !== generation) return false;
      const candidate = new ElectrumClient(net, tls, peer.ssl, peer.host, 'tls', { rejectUnauthorized: true });
      client = candidate;
      candidate.onError = () => {
        if (client === candidate) forceDisconnect();
      };
      try {
        await bounded(candidate.initElectrum({ client: 'RedWallet BTC', version: '1.4' }, { maxRetry: 0 }));
        if (!isSelected(walletID) || generation !== epoch || candidate !== client) {
          candidate.close();
          return false;
        }
        const header = await bounded(candidate.blockchainBlock_header(BTC_CHECKPOINT_HEIGHT));
        if (!isBitcoinCheckpoint(header)) throw new Error('This server is not on the Bitcoin SHA-256 chain.');
        if (!isSelected(walletID) || generation !== epoch || candidate !== client) {
          candidate.close();
          return false;
        }
        const latest: any = await bounded(candidate.blockchainHeaders_subscribe());
        if (!Number.isSafeInteger(latest?.height) || latest.height < BTC_CHECKPOINT_HEIGHT) throw new Error('Invalid Bitcoin chain height');
        if (!isSelected(walletID) || generation !== epoch || candidate !== client) {
          candidate.close();
          return false;
        }
        tip = latest.height;
        connected = true;
        emit();
        return true;
      } catch {
        candidate.close();
        if (client === candidate) client = undefined;
      }
    }
    return false;
  })();
  connecting = attempt;
  try {
    return await attempt;
  } finally {
    if (connecting === attempt) connecting = undefined;
  }
}

async function rpc<T>(walletID: string, method: string, params: unknown[]): Promise<T> {
  requireSelected(walletID);
  const epoch = generation;
  if (!(await ensureConnected(walletID))) throw new Error('Could not connect to the Bitcoin server.');
  requireSelected(walletID);
  if (epoch !== generation) throw new Error('Bitcoin wallet selection changed.');
  const active = client;
  const result = await bounded<T>(active.request(method, params));
  requireSelected(walletID);
  if (epoch !== generation || active !== client) throw new Error('Bitcoin wallet selection changed.');
  return result;
}

const scriptHash = (address: string) =>
  Buffer.from(bitcoin.crypto.sha256(bitcoin.address.toOutputScript(address)))
    .reverse()
    .toString('hex');
const validTxid = (id: string) => /^[0-9a-f]{64}$/i.test(id);
const sats = (n: number, signed = false) => {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 2_100_000_000_000_000 || (!signed && n < 0)) throw new Error('Invalid Bitcoin amount');
  return n;
};

export function assertBitcoinPayment(hex: string): void {
  const tx = bitcoin.Transaction.fromHex(hex);
  if (!tx.ins.length || !tx.outs.length) throw new Error('Bitcoin broadcast requires a signed transaction');
  for (const input of tx.ins) {
    if (input.script.length || input.witness.length !== 2) throw new Error('Bitcoin wallet requires Native SegWit inputs');
    const [signature, pubkey] = input.witness;
    if (bitcoin.script.signature.decode(signature).hashType !== bitcoin.Transaction.SIGHASH_ALL || pubkey.length !== 33) {
      throw new Error('Bitcoin broadcast refuses nonstandard or XBT Unified signatures');
    }
  }
}

/** Each method is bound to the wallet ID, so an old screen cannot use another wallet's session. */
export function forWallet(walletID: string) {
  const request = <T>(method: string, params: unknown[]) => rpc<T>(walletID, method, params);
  const getTransactionsByAddress = async (address: string): Promise<XbtElectrum.ElectrumHistory[]> => {
    const history = await request<XbtElectrum.ElectrumHistory[]>('blockchain.scripthash.get_history', [scriptHash(address)]);
    if (!Array.isArray(history)) throw new Error('Invalid Bitcoin history');
    for (const item of history) {
      if (!validTxid(item.tx_hash) || !Number.isSafeInteger(item.height) || item.height < -1 || item.height > tip) {
        throw new Error('Invalid Bitcoin history entry');
      }
      heights.set(item.tx_hash, item.height);
    }
    return history;
  };
  const getBalanceByAddress = async (address: string) => {
    const balance = await request<{ confirmed: number; unconfirmed: number }>('blockchain.scripthash.get_balance', [scriptHash(address)]);
    return { confirmed: sats(balance.confirmed), unconfirmed: sats(balance.unconfirmed, true) };
  };
  const getBlockTimestamps = async (requested: number[]) => {
    const result: Record<number, number> = {};
    for (const height of new Set(requested)) {
      if (!Number.isSafeInteger(height) || height < 1 || height > tip) throw new Error('Invalid Bitcoin block height');
      if (!timestamps.has(height)) {
        const header = await request<string>('blockchain.block.header', [height]);
        if (!/^[0-9a-f]{160}$/i.test(header)) throw new Error('Invalid Bitcoin header');
        timestamps.set(height, Buffer.from(header, 'hex').readUInt32LE(68));
      }
      result[height] = timestamps.get(height)!;
    }
    return result;
  };
  const multiGetTransactionByTxid = async <T extends boolean>(
    ids: string[],
    verbose: T,
    _batchsize = 45,
    _verifyRaw = false,
  ): Promise<T extends true ? Record<string, XbtElectrum.ElectrumTransaction> : Record<string, string>> => {
    const result: Record<string, T extends true ? XbtElectrum.ElectrumTransaction : string> = {};
    for (const id of new Set(ids)) {
      if (!validTxid(id)) throw new Error('Invalid Bitcoin transaction ID');
      const raw = await request<string>('blockchain.transaction.get', [id, false]);
      const tx = bitcoin.Transaction.fromHex(raw);
      if (tx.getId() !== id) throw new Error('Bitcoin transaction does not match its ID');
      if (!verbose) {
        result[id] = raw as T extends true ? XbtElectrum.ElectrumTransaction : string;
        continue;
      }
      const height = heights.get(id) ?? 0;
      const time = height > 0 ? (await getBlockTimestamps([height]))[height] : Math.floor(Date.now() / 1000);
      const decoded: XbtElectrum.ElectrumTransaction = {
        txid: id,
        hash: id,
        rawHex: raw,
        version: tx.version,
        size: tx.byteLength(),
        vsize: tx.virtualSize(),
        weight: tx.weight(),
        locktime: tx.locktime,
        confirmations: height > 0 ? tip - height + 1 : 0,
        time,
        blocktime: time,
        vin: tx.ins.map(input => ({
          txid: Buffer.from(input.hash).reverse().toString('hex'),
          vout: input.index,
          scriptSig: { hex: Buffer.from(input.script).toString('hex'), asm: '' },
          txinwitness: input.witness.map(w => Buffer.from(w).toString('hex')),
          sequence: input.sequence,
        })),
        vout: tx.outs.map((output, n) => {
          let addresses: string[] = [];
          try {
            addresses = [bitcoin.address.fromOutputScript(output.script)];
          } catch {}
          return {
            n,
            value: sats(Number(output.value)) / 100000000,
            scriptPubKey: {
              hex: Buffer.from(output.script).toString('hex'),
              asm: '',
              addresses,
              type: addresses.length ? 'standard' : 'nonstandard',
              reqSigs: 1,
            },
          };
        }),
      };
      result[id] = decoded as T extends true ? XbtElectrum.ElectrumTransaction : string;
    }
    return result as unknown as T extends true ? Record<string, XbtElectrum.ElectrumTransaction> : Record<string, string>;
  };
  const estimateFees = async () => {
    const rates = await Promise.all(
      [1, 6, 144].map(async blocks => {
        const rate = await request<number>('blockchain.estimatefee', [blocks]);
        if (!Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(Math.ceil(rate * 100000)))
          throw new Error('Bitcoin fee estimate unavailable');
        return Math.max(1, Math.ceil(rate * 100000));
      }),
    );
    return { fast: rates[0], medium: rates[1], slow: rates[2] };
  };
  return {
    ensureConnected: () => ensureConnected(walletID, true),
    isDisabled: async () => !isSelected(walletID),
    getPreferredServer: async () => peers[0],
    getBalanceByAddress,
    getTransactionsByAddress,
    getBlockTimestamps,
    multiGetTransactionByTxid,
    estimateFees,
    estimateCurrentBlockheight: () => tip,
    getMempoolTransactionsByAddress: (address: string) =>
      request<{ height: 0; tx_hash: string; fee: number }[]>('blockchain.scripthash.get_mempool', [scriptHash(address)]),
    multiGetHistoryByAddress: async (addresses: string[]) => {
      const result: Record<string, XbtElectrum.ElectrumHistory[]> = {};
      for (const address of addresses) result[address] = await getTransactionsByAddress(address);
      return result;
    },
    multiGetBalanceByAddress: async (addresses: string[]) => {
      const result = { balance: 0, unconfirmed_balance: 0, addresses: {} as Record<string, { confirmed: number; unconfirmed: number }> };
      for (const address of addresses) {
        const balance = await getBalanceByAddress(address);
        result.addresses[address] = balance;
        result.balance = sats(result.balance + balance.confirmed);
        result.unconfirmed_balance = sats(result.unconfirmed_balance + balance.unconfirmed, true);
      }
      return result;
    },
    multiGetUtxoByAddress: async (addresses: string[]) => {
      const result: Record<
        string,
        { height: number; value: number; address: string; txid: string; vout: number; confirmations: number }[]
      > = {};
      for (const address of addresses) {
        const entries = await request<{ tx_hash: string; tx_pos: number; height: number; value: number }[]>(
          'blockchain.scripthash.listunspent',
          [scriptHash(address)],
        );
        result[address] = entries.map(entry => {
          if (
            !validTxid(entry.tx_hash) ||
            !Number.isSafeInteger(entry.tx_pos) ||
            entry.tx_pos < 0 ||
            !Number.isSafeInteger(entry.height) ||
            entry.height < 0 ||
            entry.height > tip
          )
            throw new Error('Invalid Bitcoin UTXO');
          return {
            txid: entry.tx_hash,
            vout: entry.tx_pos,
            height: entry.height,
            value: sats(entry.value),
            address,
            confirmations: entry.height > 0 ? tip - entry.height + 1 : 0,
          };
        });
      }
      return result;
    },
    broadcastV2: async (hex: string): Promise<string> => {
      assertBitcoinPayment(hex);
      const expected = bitcoin.Transaction.fromHex(hex).getId();
      const result = await request<string>('blockchain.transaction.broadcast', [hex]);
      if (result !== expected) throw new Error('Bitcoin broadcast result is uncertain. Check transaction history before retrying.');
      return result;
    },
  };
}
