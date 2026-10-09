import DefaultPreference from 'react-native-default-preference';
/**
 * Unit tests for the BlueElectrum connection lifecycle / state machine.
 *
 * Exercises the bits that have no isolated coverage today: coalescing of
 * concurrent `ensureConnected()` callers, the generation counter that lets
 * `forceDisconnect()`/`setDisabled()` abort an in-flight connect, ping flips,
 * and the swap-check that guards against a stale client clobbering newer state.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XBT_MAINNET_CHECKPOINT_HEADER } from '../../class/xbt/electrum-checkpoint';
import fixture from '../fixtures/xbt-knots-regtest-acceptance.json';

// Jest hoists these above the import above. The factories close over `globalThis`
// so the test body can swap implementations per-test without re-mocking.
jest.mock('react-native-default-preference', () => ({
  __esModule: true,
  default: {
    setName: jest.fn(),
    get: jest.fn(async (key: string) => {
      const values: Record<string, string> = { electrum_host: 'xbt.fulcrum.test', electrum_tcp_port: '', electrum_ssl_port: '50002' };
      return values[key];
    }),
    set: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock('electrum-client', () => {
  return jest.fn().mockImplementation(() => (globalThis as any).__createNextFakeClient());
});

jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: (...args: unknown[]) => (globalThis as any).__presentAlertSpy?.(...args),
}));

type FakeClient = {
  connectDeferred: Deferred<void>;
  connect: jest.Mock;
  server_version: jest.Mock;
  initElectrumDeferred: Deferred<[string, string]>;
  headersDeferred: Deferred<{ height: number }>;
  pingDeferred: Deferred<unknown> | null;
  pingShouldReject: boolean;
  closed: boolean;
  onError?: (e: { message: string }) => void;
  host: string;
  port: number;
  initElectrum: jest.Mock;
  blockchainBlock_header: jest.Mock;
  blockchainHeaders_subscribe: jest.Mock;
  blockchainScripthash_getHistory: jest.Mock;
  blockchainTransaction_get: jest.Mock;
  blockchainTransaction_broadcast: jest.Mock;
  server_ping: jest.Mock;
  close: jest.Mock;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolveOuter!: (v: T) => void;
  let rejectOuter!: (e: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });
  return { promise, resolve: resolveOuter, reject: rejectOuter };
}

function makeFakeClient(host = 'fake.host', port = 50002): FakeClient {
  const fc: Partial<FakeClient> = {
    connectDeferred: deferred<void>(),
    initElectrumDeferred: deferred<[string, string]>(),
    headersDeferred: deferred<{ height: number }>(),
    pingDeferred: null,
    pingShouldReject: false,
    closed: false,
    host,
    port,
  };
  fc.connect = jest.fn(() => fc.connectDeferred!.promise);
  fc.server_version = jest.fn(async () => ['Fulcrum', '1.4']);
  fc.initElectrum = jest.fn(() => fc.initElectrumDeferred!.promise);
  fc.blockchainHeaders_subscribe = jest.fn(() => fc.headersDeferred!.promise);
  fc.blockchainBlock_header = jest.fn(async () => XBT_MAINNET_CHECKPOINT_HEADER);
  fc.blockchainScripthash_getHistory = jest.fn();
  fc.blockchainTransaction_get = jest.fn();
  fc.blockchainTransaction_broadcast = jest.fn(async () => 'a'.repeat(64));
  fc.server_ping = jest.fn(() => {
    fc.pingDeferred = deferred<unknown>();
    if (fc.pingShouldReject) {
      fc.pingDeferred.reject(new Error('ping failed'));
    } else {
      fc.pingDeferred.resolve(undefined);
    }
    return fc.pingDeferred.promise;
  });
  fc.close = jest.fn(() => {
    fc.closed = true;
  });
  return fc as FakeClient;
}

const created: FakeClient[] = [];
(globalThis as any).__createNextFakeClient = () => {
  const c = makeFakeClient();
  created.push(c);
  return c;
};

const presentAlertMock = jest.fn();
(globalThis as any).__presentAlertSpy = presentAlertMock;

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function flush(times = 4) {
  for (let i = 0; i < times; i++) await tick();
}

function resolveLastConnect() {
  const c = created[created.length - 1];
  c.initElectrumDeferred.resolve(['Fulcrum 1.10.0', '1.4']);
  c.headersDeferred.resolve({ height: 1000 });
}

describe('BlueElectrum lifecycle', () => {
  beforeEach(async () => {
    BlueElectrum.forceDisconnect();
    await BlueElectrum.setDisabled(false);
    created.length = 0;
    presentAlertMock.mockClear();
  });

  describe('server batch-limit recovery', () => {
    const address = bitcoin.address.fromOutputScript(Buffer.from('0014' + '11'.repeat(20), 'hex'));
    const txid = 'ab'.repeat(32);
    beforeEach(async () => {
      const connected = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await connected;
    });

    it.each(['balance', 'history', 'utxo', 'transaction'])('recovers rejected %s batches using individual requests', async kind => {
      const client = created[0] as FakeClient & Record<string, jest.Mock>;
      const methods: Record<string, string> = {
        balance: 'blockchainScripthash_getBalance',
        history: 'blockchainScripthash_getHistory',
        utxo: 'blockchainScripthash_listunspent',
        transaction: 'blockchainTransaction_get',
      };
      const method = methods[kind];
      client[method + 'Batch'] = jest.fn(async () => {
        throw new Error('Batch limit exceeded');
      });
      const values: Record<string, unknown> = {
        balance: { confirmed: 123, unconfirmed: 0 },
        history: [{ tx_hash: txid, height: 1 }],
        utxo: [{ tx_hash: txid, tx_pos: 0, height: 1, value: 123 }],
        transaction: fixture.signed.goodHex,
      };
      client[method] = jest.fn(async () => values[kind]);
      if (kind === 'balance') expect((await BlueElectrum.multiGetBalanceByAddress([address])).balance).toBe(123);
      if (kind === 'history') expect((await BlueElectrum.multiGetHistoryByAddress([address]))[address][0].tx_hash).toBe(txid);
      if (kind === 'utxo') expect((await BlueElectrum.multiGetUtxoByAddress([address]))[address][0].txid).toBe(txid);
      if (kind === 'transaction') expect((await BlueElectrum.multiGetTransactionByTxid([txid], false))[txid]).toBe(fixture.signed.goodHex);
      expect(client[method + 'Batch']).toHaveBeenCalledTimes(1);
      expect(client[method]).toHaveBeenCalledTimes(1);
    });

    it('recovers every address sequentially without dropping transaction history', async () => {
      const client = created[0] as FakeClient & Record<string, jest.Mock>;
      const addresses = ['11', '22', '33'].map(byte => bitcoin.address.fromOutputScript(Buffer.from('0014' + byte.repeat(20), 'hex')));
      client.blockchainScripthash_getHistoryBatch = jest.fn(async () => {
        // eslint-disable-next-line no-throw-literal -- Simulate a plain JSON-RPC error object from the server.
        throw { message: 'Batch limit exceeded' };
      });
      let active = 0;
      let maximum = 0;
      client.blockchainScripthash_getHistory.mockImplementation(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await tick();
        active--;
        return [{ tx_hash: txid, height: 1 }];
      });
      const histories = await BlueElectrum.multiGetHistoryByAddress(addresses);
      expect(maximum).toBe(1);
      expect(client.blockchainScripthash_getHistory).toHaveBeenCalledTimes(3);
      for (const addr of addresses) expect(histories[addr][0]).toMatchObject({ tx_hash: txid, address: addr });
    });

    it('decodes a raw single transaction returned for a verbose fallback', async () => {
      const client = created[0] as FakeClient & Record<string, jest.Mock>;
      client.blockchainTransaction_getBatch = jest.fn(async () => {
        throw new Error('Batch limit exceeded');
      });
      client.blockchainTransaction_get.mockResolvedValue(fixture.signed.goodHex);
      const tx = (await BlueElectrum.multiGetTransactionByTxid(['ef'.repeat(32)], true))['ef'.repeat(32)];
      expect(tx.vin.length).toBeGreaterThan(0);
      expect(tx.vout.length).toBeGreaterThan(0);
    });

    it('does not turn an authentication/network error into a retry or empty history', async () => {
      const client = created[0] as FakeClient & Record<string, jest.Mock>;
      client.blockchainScripthash_getHistoryBatch = jest.fn(async () => {
        throw new Error('Certificate hostname mismatch');
      });
      await expect(BlueElectrum.multiGetHistoryByAddress([address])).rejects.toThrow('Certificate hostname mismatch');
      expect(client.blockchainScripthash_getHistory).not.toHaveBeenCalled();
    });

    it('propagates individual history failure instead of reporting an empty wallet', async () => {
      const client = created[0] as FakeClient & Record<string, jest.Mock>;
      client.blockchainScripthash_getHistoryBatch = jest.fn(async () => {
        throw new Error('Batch limit exceeded');
      });
      client.blockchainScripthash_getHistory.mockRejectedValue(new Error('Connection lost'));
      await expect(BlueElectrum.multiGetHistoryByAddress([address])).rejects.toThrow('Connection lost');
    });
  });

  describe('raw history output decoding', () => {
    function transactionWith(script: string) {
      const tx = new bitcoin.Transaction();
      tx.addInput(Buffer.alloc(32, 1), 0);
      tx.addOutput(Buffer.from(script, 'hex'), 1000n);
      tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), 2000n);
      return tx;
    }

    it.each([
      ['data output', '6a0464656d6f', 'nulldata'],
      ['bare public key', '210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ac', 'nonstandard'],
      ['non-address script', '51', 'nonstandard'],
      ['empty script', '', 'nonstandard'],
    ])('retains %s without aborting history or shifting output indices', (_label, script, type) => {
      const tx = transactionWith(script);
      const decoded = BlueElectrum.txhexToElectrumTransaction(tx.toHex());
      expect(decoded.txid).toBe(tx.getId());
      expect(decoded.vout).toHaveLength(2);
      expect(decoded.vout[0]).toMatchObject({ n: 0, value: 0.00001, scriptPubKey: { hex: script, type, addresses: [] } });
      expect(decoded.vout[1]).toMatchObject({
        n: 1,
        value: 0.00002,
        scriptPubKey: { addresses: [bitcoin.address.fromOutputScript(tx.outs[1].script)] },
      });
      expect(decoded.hex).toBe(tx.toHex());
    });

    it('decodes P2WSH destinations alongside owned P2WPKH outputs', () => {
      const tx = transactionWith('0020' + '22'.repeat(32));
      const decoded = BlueElectrum.txhexToElectrumTransaction(tx.toHex());
      expect(decoded.vout[0].scriptPubKey).toMatchObject({
        type: 'witness_v0_scripthash',
        addresses: [bitcoin.address.fromOutputScript(tx.outs[0].script)],
      });
      expect(decoded.vout[1].scriptPubKey.addresses).toHaveLength(1);
    });

    it('loads raw coinbase history without requesting its null parent', async () => {
      const connected = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await connected;
      const tx = new bitcoin.Transaction();
      tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('0101', 'hex'));
      tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), 1000n);
      tx.addOutput(Buffer.from('6a24aa21a9ed' + '00'.repeat(32), 'hex'), 0n);
      const client = created[0];
      client.blockchainScripthash_getHistory.mockResolvedValue([{ tx_hash: tx.getId(), height: 900 }]);
      client.blockchainTransaction_get.mockImplementation(async (txid: string) => {
        if (txid === '0'.repeat(64)) throw new Error('Coinbase null outpoint must not be queried');
        return BlueElectrum.txhexToElectrumTransaction(tx.toHex());
      });
      const history = await BlueElectrum.getTransactionsFullByAddress(bitcoin.address.fromOutputScript(tx.outs[0].script));
      expect(history).toHaveLength(1);
      expect(history[0].txid).toBe(tx.getId());
      expect(history[0]).toMatchObject({
        outputs: [
          { n: 0, value: 0.00001 },
          { n: 1, value: 0, addresses: [] },
        ],
      });
      expect(client.blockchainTransaction_get.mock.calls.map(call => call[0])).toEqual([tx.getId()]);
    });

    it('still rejects malformed raw transactions', () => {
      expect(() => BlueElectrum.txhexToElectrumTransaction('01000000')).toThrow();
    });

    it('loads mixed-output raw history after batch-limit recovery', async () => {
      const connected = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await connected;
      const client = created[0] as FakeClient & Record<string, jest.Mock>;
      client.blockchainTransaction_getBatch = jest.fn(async () => {
        throw new Error('Batch limit exceeded');
      });
      const tx = transactionWith('6a0464656d6f');
      client.blockchainTransaction_get.mockResolvedValue(tx.toHex());
      const result = (await BlueElectrum.multiGetTransactionByTxid([tx.getId()], true))[tx.getId()];
      expect(result.vout).toHaveLength(2);
      expect(result.vout[0].scriptPubKey.addresses).toEqual([]);
      expect(result.vout[1].scriptPubKey.addresses).toHaveLength(1);
    });
  });

  describe('settings connection authentication deadline', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('waits for authenticated TLS beyond five seconds before making RPCs', async () => {
      const pending = BlueElectrum.testConnection('private.example', undefined, 50002, 'configured certificate');
      const client = created[0];
      await jest.advanceTimersByTimeAsync(6000);
      expect(client.server_version).not.toHaveBeenCalled();
      expect(client.blockchainBlock_header).not.toHaveBeenCalled();
      expect(client.close).not.toHaveBeenCalled();
      client.connectDeferred.resolve();
      await expect(pending).resolves.toBe(true);
      expect(client.blockchainBlock_header).toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(1);
    });

    it('closes a stalled TLS handshake at its bounded deadline without RPCs', async () => {
      const pending = BlueElectrum.testConnection('private.example', undefined, 50002);
      const client = created[0];
      await jest.advanceTimersByTimeAsync(15000);
      await expect(pending).resolves.toBe(false);
      expect(client.close).toHaveBeenCalledTimes(1);
      client.connectDeferred.resolve();
      await jest.advanceTimersByTimeAsync(0);
      expect(client.server_version).not.toHaveBeenCalled();
      expect(client.blockchainBlock_header).not.toHaveBeenCalled();
      expect(created).toHaveLength(1);
    });

    it('rejects a TLS authentication error immediately with no retry or fallback', async () => {
      const pending = BlueElectrum.testConnection('private.example', undefined, 50002);
      const client = created[0];
      client.connectDeferred.reject(new Error('Certificate hostname mismatch'));
      await expect(pending).resolves.toBe(false);
      expect(client.server_version).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
    });

    it('still rejects an authenticated endpoint on the wrong chain', async () => {
      const pending = BlueElectrum.testConnection('private.example', undefined, 50002);
      const client = created[0];
      client.blockchainBlock_header.mockResolvedValue('00'.repeat(80));
      client.connectDeferred.resolve();
      await expect(pending).resolves.toBe(false);
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
    });

    it('retains the five-second deadline for intentional plain TCP', async () => {
      const pending = BlueElectrum.testConnection('private.example', 50001);
      const client = created[0];
      await jest.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBe(false);
      expect(client.server_version).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(1);
    });

    it('retains the longer deadline for an onion connection', async () => {
      const pending = BlueElectrum.testConnection('private.onion', undefined, 50002);
      const client = created[0];
      await jest.advanceTimersByTimeAsync(16000);
      expect(client.close).not.toHaveBeenCalled();
      client.connectDeferred.resolve();
      await expect(pending).resolves.toBe(true);
    });
  });

  describe('coalescing', () => {
    it('two concurrent ensureConnected() share one in-flight attempt', async () => {
      const p1 = BlueElectrum.ensureConnected();
      const p2 = BlueElectrum.ensureConnected();

      await flush();
      expect(created.length).toBe(1);

      resolveLastConnect();
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(BlueElectrum.getConnectionState()).toBe('connected');
      expect(created.length).toBe(1);
    });
  });

  describe('Unified broadcast boundary', () => {
    it('rejects a non-Unified witness in both broadcast APIs before opening a connection', async () => {
      for (const broadcast of [BlueElectrum.broadcast, BlueElectrum.broadcastV2]) {
        await expect(broadcast(fixture.signed.negativeControls.removedUnifiedBitHex)).rejects.toThrow('without SIGHASH_ALL');
      }
      expect(created).toHaveLength(0);
    });

    it('never submits a non-Unified witness to a connected client, but allows a valid payment', async () => {
      const connected = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await connected;
      const client = created[0];
      for (const broadcast of [BlueElectrum.broadcast, BlueElectrum.broadcastV2]) {
        await expect(broadcast(fixture.signed.negativeControls.removedUnifiedBitHex)).rejects.toThrow('without SIGHASH_ALL');
        expect(client.blockchainTransaction_broadcast).not.toHaveBeenCalled();
      }
      for (const broadcast of [BlueElectrum.broadcast, BlueElectrum.broadcastV2]) {
        await expect(broadcast(fixture.signed.goodHex)).resolves.toBe('a'.repeat(64));
      }
      expect(client.blockchainTransaction_broadcast).toHaveBeenCalledTimes(2);
      expect(client.blockchainTransaction_broadcast).toHaveBeenLastCalledWith(fixture.signed.goodHex);
    });
  });

  describe('forceDisconnect during in-flight connect', () => {
    it('aborts cleanly; state ends "disconnected" even if the socket resolves later', async () => {
      const p = BlueElectrum.ensureConnected();
      await flush();
      expect(created.length).toBe(1);
      expect(BlueElectrum.getConnectionState()).toBe('connecting');

      BlueElectrum.forceDisconnect();
      // Late resolve from the doomed attempt must not flip state back to 'connected'.
      resolveLastConnect();

      const result = await p;
      expect(result).toBe(false);
      expect(BlueElectrum.getConnectionState()).toBe('disconnected');
    });
  });

  describe('setDisabled(true) during in-flight connect', () => {
    it('bumps generation, tears down the socket, leaves state "disabled"', async () => {
      const p = BlueElectrum.ensureConnected();
      await flush();
      expect(created.length).toBe(1);
      expect(BlueElectrum.getConnectionState()).toBe('connecting');

      await BlueElectrum.setDisabled(true);
      // Late resolve from the doomed attempt must not flip state back to 'connected'.
      resolveLastConnect();

      const result = await p;
      expect(result).toBe(false);
      expect(BlueElectrum.getConnectionState()).toBe('disabled');
      expect(created[0].close).toHaveBeenCalled();
    });
  });

  describe('ping fast-path', () => {
    it('successful ping on existing client returns true without a new connect', async () => {
      // First, establish a connection.
      const connectPromise = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await connectPromise;
      expect(BlueElectrum.getConnectionState()).toBe('connected');

      // Now ensureConnected() should ping the existing client, not construct another.
      const second = await BlueElectrum.ensureConnected();
      expect(second).toBe(true);
      expect(created.length).toBe(1);
      expect(created[0].server_ping).toHaveBeenCalled();
    });

    it('ping() on a connected client flipping to reject moves state to "disconnected"', async () => {
      const connectPromise = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await connectPromise;
      expect(BlueElectrum.getConnectionState()).toBe('connected');

      created[0].pingShouldReject = true;
      const ok = await BlueElectrum.ping();

      expect(ok).toBe(false);
      expect(BlueElectrum.getConnectionState()).toBe('disconnected');
    });
  });

  describe('subscribeConnectionState', () => {
    it('notifies on transitions and stops after unsubscribe', async () => {
      const seen: string[] = [];
      const unsub = BlueElectrum.subscribeConnectionState(s => seen.push(s));

      const p = BlueElectrum.ensureConnected();
      await flush();
      expect(seen).toContain('connecting');

      resolveLastConnect();
      await p;
      expect(seen).toContain('connected');

      unsub();
      BlueElectrum.forceDisconnect();
      // After unsubscribe, the 'disconnected' transition should not be recorded.
      expect(seen[seen.length - 1]).toBe('connected');
    });
  });

  describe('isConnected / getConnectionState agree with the machine', () => {
    it('both reflect the current state', async () => {
      expect(BlueElectrum.isConnected()).toBe(false);
      expect(BlueElectrum.getConnectionState()).toBe('disconnected');

      const p = BlueElectrum.ensureConnected();
      await flush();
      resolveLastConnect();
      await p;

      expect(BlueElectrum.isConnected()).toBe(true);
      expect(BlueElectrum.getConnectionState()).toBe('connected');
    });
  });

  describe('getConfirmedBlockHeight', () => {
    const TEST_ADDRESS = 'bc1qe7q08prc2spln2l7qdvvlcgqxm9za9z7mjnpzc';
    const TX_HASH = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    async function connectAtTip(height: number) {
      const connectPromise = BlueElectrum.ensureConnected();
      await flush();
      const client = created[created.length - 1];
      client.initElectrumDeferred.resolve(['Fulcrum 1.10.0', '1.4']);
      client.headersDeferred.resolve({ height });
      await connectPromise;
      return client;
    }

    async function seedTxHeightCache(client: FakeClient, txHash: string, height: number) {
      client.blockchainScripthash_getHistory.mockResolvedValue([{ tx_hash: txHash, height }]);
      await BlueElectrum.getTransactionsByAddress(TEST_ADDRESS);
    }

    it('returns null for implausible height without caching', async () => {
      const client = await connectAtTip(1000);

      client.blockchainTransaction_get.mockResolvedValue({ confirmations: 2000 });

      const result = await BlueElectrum.getConfirmedBlockHeight('deadbeef');
      expect(result).toBeNull();
    });

    it('returns cached height when cache is within tip', async () => {
      const client = await connectAtTip(1000);
      await seedTxHeightCache(client, TX_HASH, 995);

      const result = await BlueElectrum.getConfirmedBlockHeight(TX_HASH);
      expect(result).toEqual({ height: 995, tip: 1000 });
      expect(client.blockchainTransaction_get).not.toHaveBeenCalled();
    });

    it('refreshes tip when cached height is slightly ahead of TTL tip', async () => {
      const client = await connectAtTip(1000);
      await seedTxHeightCache(client, TX_HASH, 1001);

      client.blockchainHeaders_subscribe.mockResolvedValue({ height: 1001 });

      const result = await BlueElectrum.getConfirmedBlockHeight(TX_HASH);
      expect(result).toEqual({ height: 1001, tip: 1001 });
      expect(client.blockchainTransaction_get).not.toHaveBeenCalled();
    });

    it('discards poisoned cache and fetches height from server', async () => {
      const client = await connectAtTip(1000);
      await seedTxHeightCache(client, TX_HASH, 2000);

      client.blockchainHeaders_subscribe.mockResolvedValue({ height: 1000 });
      client.blockchainTransaction_get.mockResolvedValue({ confirmations: 5 });

      const result = await BlueElectrum.getConfirmedBlockHeight(TX_HASH);
      expect(result).toEqual({ height: 996, tip: 1000 });
      expect(client.blockchainTransaction_get).toHaveBeenCalledWith(TX_HASH, true);
    });
  });
});

describe('explicit backup server resilience', () => {
  afterEach(() => jest.restoreAllMocks());
  it('tries the opted-in TLS backup after primary failure without changing the preferred server', async () => {
    const get = DefaultPreference.get as jest.Mock;
    const original = get.getMockImplementation()!;
    get.mockImplementation(async (key: string) =>
      key === BlueElectrum.ELECTRUM_BACKUP_SERVERS ? JSON.stringify([{ host: 'backup.xbt.test', ssl: 50002 }]) : original(key),
    );
    BlueElectrum.forceDisconnect();
    const start = created.length;
    const promise = BlueElectrum.ensureConnected();
    await flush();
    created[start].initElectrumDeferred.reject(new Error('Primary unavailable'));
    await new Promise(resolve => setTimeout(resolve, 1100));
    await flush();
    resolveLastConnect();
    expect(await promise).toBe(true);
    const ElectrumClient = require('electrum-client');
    expect(ElectrumClient.mock.calls.at(-1)[3]).toBe('backup.xbt.test');
    expect(ElectrumClient.mock.calls.at(-1)[4]).toBe('tls');
    expect(created.at(-1)!.blockchainBlock_header).toHaveBeenCalled();
    get.mockImplementation(original);
    BlueElectrum.forceDisconnect();
  });
  it('changing backups aborts an in-flight connection', async () => {
    BlueElectrum.forceDisconnect();
    const promise = BlueElectrum.ensureConnected();
    await flush();
    const old = created.at(-1)!;
    await BlueElectrum.setBackupServers([{ host: 'backup.xbt.test', ssl: 50002 }]);
    old.initElectrumDeferred.resolve(['Fulcrum 1.10.0', '1.4']);
    old.headersDeferred.resolve({ height: 1000 });
    expect(await promise).toBe(false);
    expect(BlueElectrum.isConnected()).toBe(false);
    expect(old.closed).toBe(true);
  });
});

test.each(['rpc-error', 'missing', 'malformed'])('history %s is never treated as an unused address', async failure => {
  BlueElectrum.forceDisconnect();
  const connect = BlueElectrum.ensureConnected();
  await flush();
  resolveLastConnect();
  expect(await connect).toBe(true);
  const client = created.at(-1)!;
  (client as any).blockchainScripthash_getHistoryBatch = jest.fn(async (hashes: string[]) =>
    failure === 'missing'
      ? []
      : hashes.map(param => ({
          param,
          result: failure === 'malformed' ? null : undefined,
          ...(failure === 'rpc-error' ? { error: { code: -1, message: 'History unavailable' } } : {}),
        })),
  );
  const address = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 1) }).address!;
  await expect(BlueElectrum.multiGetHistoryByAddress([address])).rejects.toThrow();
  BlueElectrum.forceDisconnect();
});
