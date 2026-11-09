import * as bitcoin from 'bitcoinjs-lib';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeCertificatePem } from './tls-certificate';
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

export interface BtcElectrumServer {
  host: string;
  ssl?: number;
  tcp?: number;
  tlsCa?: string;
}

export const BTC_SERVER_SETTINGS_KEY = 'redwallet.btcElectrumServer.v1';
export const DEFAULT_BTC_SERVER: Readonly<BtcElectrumServer> = Object.freeze({
  host: 'electrum.blockstream.info',
  ssl: 50002,
});
let configurationQueue: Promise<void> = Promise.resolve();

class BtcServerCheckError extends Error {}

export function validateServerConfiguration(value: unknown): BtcElectrumServer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid BTC server configuration.');
  const input = value as BtcElectrumServer;
  if (typeof input.host !== 'string') throw new Error('Enter the BTC server hostname or IP address.');
  let host = input.host.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const groups = host.split('::');
  const hexGroups = host.split(':').filter(Boolean);
  const ipv6 =
    host.includes(':') &&
    groups.length <= 2 &&
    groups.every(side => !side || side.split(':').every(group => /^[a-f0-9]{1,4}$/.test(group))) &&
    /^[a-f0-9:]+$/.test(host) &&
    hexGroups.every(group => /^[a-f0-9]{1,4}$/.test(group)) &&
    (groups.length === 2 ? hexGroups.length < 8 : hexGroups.length === 8 && !host.startsWith(':') && !host.endsWith(':'));
  const dns = host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  const ipv4 = !/^[0-9.]+$/.test(host) || (host.split('.').length === 4 && host.split('.').every(part => Number(part) <= 255));
  if (!host || (!ipv6 && (!dns || !ipv4))) throw new Error('Enter a hostname or IP address without a URL scheme, path or port.');
  if (host.endsWith('.onion'))
    throw new Error('BTC server connections currently use the direct network. Onion hosts are not supported here.');
  if ((input.ssl === undefined) === (input.tcp === undefined)) throw new Error('Choose exactly one BTC server port: SSL or TCP.');
  const port = input.ssl ?? input.tcp;
  if (!Number.isSafeInteger(port) || port! < 1 || port! > 65535) throw new Error('Enter a BTC server port from 1 to 65535.');
  if (input.tlsCa !== undefined && typeof input.tlsCa !== 'string') throw new Error('Invalid trusted BTC server certificate.');
  const certificate = normalizeCertificatePem((input.tlsCa || '').trim());
  if (certificate && !input.ssl) throw new Error('A trusted certificate requires SSL.');
  if (
    certificate &&
    (certificate.length > 16384 || !/^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----$/.test(certificate))
  ) {
    throw new Error('Enter one PEM certificate obtained from your trusted server operator.');
  }
  return {
    host,
    ...(input.ssl ? { ssl: port } : { tcp: port }),
    ...(certificate ? { tlsCa: certificate } : {}),
  };
}

/** Missing configuration uses the default; unreadable or malformed custom settings never do. */
export async function getPreferredServer(): Promise<BtcElectrumServer> {
  try {
    const saved = await AsyncStorage.getItem(BTC_SERVER_SETTINGS_KEY);
    return saved === null ? { ...DEFAULT_BTC_SERVER } : validateServerConfiguration(JSON.parse(saved));
  } catch {
    throw new Error('BTC server settings could not be read. Open Network > BTC SHA-256 Server to save a server or restore the default.');
  }
}

function makeClient(server: BtcElectrumServer) {
  return new ElectrumClient(
    net,
    tls,
    server.ssl ?? server.tcp,
    server.host,
    server.ssl ? 'tls' : 'tcp',
    server.ssl
      ? {
          rejectUnauthorized: true,
          ...(server.tlsCa ? { ca: server.tlsCa } : {}),
        }
      : undefined,
  );
}

function queueConfigurationChange(change: () => Promise<void>): Promise<void> {
  const next = configurationQueue.then(change, change);
  configurationQueue = next.catch(() => {});
  return next;
}

/** An explicit save probes protocol/chain only; no wallet address or transaction is requested. */
export function setPreferredServer(value: BtcElectrumServer): Promise<void> {
  const server = validateServerConfiguration(value);
  return queueConfigurationChange(async () => {
    const probe = makeClient(server);
    probe.onError = () => {};
    try {
      await bounded(probe.initElectrum({ client: 'RedWallet BTC server check', version: '1.4' }, { maxRetry: 0 }));
      const header = await bounded(probe.blockchainBlock_header(BTC_CHECKPOINT_HEIGHT));
      if (!isBitcoinCheckpoint(header))
        throw new BtcServerCheckError('This server is not on the Bitcoin SHA-256 chain. BTC settings were not saved.');
      const latest: any = await bounded(probe.blockchainHeaders_subscribe());
      if (!Number.isSafeInteger(latest?.height) || latest.height < BTC_CHECKPOINT_HEIGHT) {
        throw new BtcServerCheckError('The BTC server returned an invalid chain height. Settings were not saved.');
      }
    } catch (error) {
      if (error instanceof BtcServerCheckError) throw error;
      throw new Error(
        'Could not verify the BTC server. Check the host, port, SSL selection and trusted certificate. Settings were not saved.',
      );
    } finally {
      try {
        probe.close();
      } catch {}
    }
    // One atomic preference write; never touch XBT's separate configuration.
    await AsyncStorage.setItem(BTC_SERVER_SETTINGS_KEY, JSON.stringify(server));
    forceDisconnect();
  });
}

export function resetPreferredServer(): Promise<void> {
  return queueConfigurationChange(async () => {
    await AsyncStorage.removeItem(BTC_SERVER_SETTINGS_KEY);
    forceDisconnect();
  });
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
    for (const peer of [await getPreferredServer()]) {
      if (!isSelected(walletID) || epoch !== generation) return false;
      const candidate = makeClient(peer);
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
    return {
      confirmed: sats(balance.confirmed),
      unconfirmed: sats(balance.unconfirmed, true),
    };
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
          scriptSig: {
            hex: Buffer.from(input.script).toString('hex'),
            asm: '',
          },
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
    getPreferredServer,
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
      const result = {
        balance: 0,
        unconfirmed_balance: 0,
        addresses: {} as Record<string, { confirmed: number; unconfirmed: number }>,
      };
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
        {
          height: number;
          value: number;
          address: string;
          txid: string;
          vout: number;
          confirmations: number;
        }[]
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
