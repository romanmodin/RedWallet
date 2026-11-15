import * as bitcoin from 'bitcoinjs-lib';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Btc from '../../blue_modules/BtcElectrum';
import { XBT_MAINNET_CHECKPOINT_HEADER } from '../../class/xbt/electrum-checkpoint';

const mockHeader =
  '00c0cd2f5020e5d6a59cf5acc8ab25e86ded4c3528c5216205ca01000000000000000000317c696ea6df187e55b05be2146a5afffa3d3f7d9c23c8cec147d52d9f8b3e0ea6a6776a3d35021742202ecb';
const mockClients: any[] = [];
jest.mock('electrum-client', () =>
  jest.fn().mockImplementation(() => {
    const client = {
      initElectrum: jest.fn().mockResolvedValue({}),
      blockchainBlock_header: jest.fn().mockImplementation(async () => mockHeader),
      blockchainHeaders_subscribe: jest.fn().mockResolvedValue({ height: 981000 }),
      request: jest.fn(),
      close: jest.fn(),
      onError: undefined,
    };
    mockClients.push(client);
    return client;
  }),
);
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
beforeEach(() => {
  Btc.selectWallet();
  Btc.setForeground(true);
  mockClients.length = 0;
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => {
  Btc.selectWallet();
});

test('identifies BTC with its post-fork checkpoint, rejecting XBT, malformed and mutated headers', () => {
  expect(Btc.isBitcoinCheckpoint(mockHeader)).toBe(true);
  expect(Btc.isBitcoinCheckpoint(mockHeader.toUpperCase())).toBe(true);
  expect(Btc.isBitcoinCheckpoint(XBT_MAINNET_CHECKPOINT_HEADER)).toBe(false);
  expect(Btc.isBitcoinCheckpoint('01' + mockHeader.slice(2))).toBe(false);
  expect(Btc.isBitcoinCheckpoint('00'.repeat(80))).toBe(false);
});
test('does not connect on import, inactive refresh, or a direct address read', async () => {
  const backend = Btc.forWallet('blue', () => [address]);
  expect(await backend.ensureConnected()).toBe(false);
  await expect(backend.getBalanceByAddress(address)).rejects.toThrow('Select the blue BTC wallet');
  expect(mockClients).toHaveLength(0);
});
test('uses authenticated TLS and only the selected blue wallet session', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  expect(await backend.ensureConnected()).toBe(true);
  expect(require('electrum-client')).toHaveBeenCalledWith(expect.anything(), expect.anything(), 50002, 'electrum.blockstream.info', 'tls', {
    rejectUnauthorized: true,
  });
  mockClients[0].request.mockResolvedValue({ confirmed: 1000, unconfirmed: 0 });
  expect(await backend.getBalanceByAddress(address)).toEqual({
    confirmed: 1000,
    unconfirmed: 0,
  });
  Btc.selectWallet();
  expect(mockClients[0].close).toHaveBeenCalled();
  await expect(backend.getBalanceByAddress(address)).rejects.toThrow();
  expect(await backend.ensureConnected()).toBe(false);
});
test('backgrounding closes BTC and cannot reconnect until the selected wallet is foregrounded', async () => {
  Btc.selectWallet('blue');
  await Btc.forWallet('blue').ensureConnected();
  Btc.setForeground(false);
  expect(mockClients[0].close).toHaveBeenCalled();
  expect(await Btc.forWallet('blue').ensureConnected()).toBe(false);
  Btc.setForeground(true);
  expect(await Btc.forWallet('blue').ensureConnected()).toBe(true);
  expect(mockClients).toHaveLength(2);
});
test('rejects a read completing after switching to another blue wallet', async () => {
  Btc.selectWallet('a');
  const backend = Btc.forWallet('a');
  await backend.ensureConnected();
  let finish!: (value: unknown) => void;
  mockClients[0].request.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const result = backend.getBalanceByAddress(address);
  await Promise.resolve();
  await Promise.resolve();
  Btc.selectWallet('b');
  finish({ confirmed: 1234, unconfirmed: 0 });
  await expect(result).rejects.toThrow('Select the blue BTC wallet');
});
test('rejects an incorrect chain before sending any address request', async () => {
  Btc.selectWallet('a');
  const ctor = require('electrum-client');
  ctor.mockImplementationOnce(() => {
    const client = {
      initElectrum: async () => ({}),
      blockchainBlock_header: async () => XBT_MAINNET_CHECKPOINT_HEADER,
      request: jest.fn(),
      close: jest.fn(),
    };
    mockClients.push(client);
    return client;
  });
  await expect(Btc.forWallet('a').getBalanceByAddress(address)).rejects.toThrow('Could not connect');
  expect(mockClients[0].request).not.toHaveBeenCalled();
});
test('does not continue a connection handshake after the blue wallet is deselected', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const client = {
    initElectrum: () => pending,
    blockchainBlock_header: jest.fn(),
    close: jest.fn(),
  };
  require('electrum-client').mockImplementationOnce(() => client);
  Btc.selectWallet('blue');
  const connecting = Btc.forWallet('blue').ensureConnected();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  Btc.selectWallet();
  finish({});
  expect(await connecting).toBe(false);
  expect(client.close).toHaveBeenCalled();
  expect(client.blockchainBlock_header).not.toHaveBeenCalled();
  expect(Btc.getConnectionState()).toBe('inactive');
});
test.each([NaN, -1, 2_100_000_000_000_001, 1.5])('rejects a malformed confirmed balance: %s', async value => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  mockClients[0].request.mockResolvedValue({
    confirmed: value,
    unconfirmed: 0,
  });
  await expect(backend.getBalanceByAddress(address)).rejects.toThrow('Invalid Bitcoin amount');
});
test('verifies raw transaction IDs instead of trusting verbose server amounts', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address), 1200n);
  mockClients[0].request.mockImplementation(async (method: string) => (method === 'blockchain.transaction.get' ? tx.toHex() : []));
  const result = await backend.multiGetTransactionByTxid([tx.getId()], true);
  expect(result[tx.getId()].vout[0].value).toBe(0.000012);
  expect(result[tx.getId()].rawHex).toBe(tx.toHex());
  await expect(backend.multiGetTransactionByTxid(['22'.repeat(32)], true)).rejects.toThrow('does not match');
});

test('persists only a verified custom BTC endpoint and uses it after reconnecting', async () => {
  const stored = new Map<string, string>();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => stored.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  Btc.selectWallet('blue');
  await Btc.forWallet('blue').ensureConnected();
  const previous = mockClients[0];
  await Btc.setPreferredServer({ host: ' MY.BTC.SERVER ', ssl: 51002 });
  expect(stored.get(Btc.BTC_SERVER_SETTINGS_KEY)).toBe(JSON.stringify({ host: 'my.btc.server', ssl: 51002 }));
  expect(previous.close).toHaveBeenCalled();
  expect(mockClients[1].request).not.toHaveBeenCalled(); // Saving discloses no wallet address.
  expect(mockClients[1].close).toHaveBeenCalled();
  expect(await Btc.getPreferredServer()).toEqual({
    host: 'my.btc.server',
    ssl: 51002,
  });
  await Btc.forWallet('blue').ensureConnected();
  expect(require('electrum-client')).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 51002, 'my.btc.server', 'tls', {
    rejectUnauthorized: true,
  });
});

test('an unreachable saved custom server never falls back to the public default', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ host: 'private.server', ssl: 51002 }));
  const closed = jest.fn();
  require('electrum-client').mockImplementationOnce(() => ({
    initElectrum: async () => {
      throw new Error('unreachable');
    },
    close: closed,
  }));
  Btc.selectWallet('blue');
  expect(await Btc.forWallet('blue').ensureConnected()).toBe(false);
  expect(require('electrum-client')).toHaveBeenCalledTimes(1);
  expect(require('electrum-client')).toHaveBeenCalledWith(expect.anything(), expect.anything(), 51002, 'private.server', 'tls', {
    rejectUnauthorized: true,
  });
  expect(closed).toHaveBeenCalled();
});

test.each(['{bad json', '{}', 'null', JSON.stringify({ host: 'bad.server', ssl: 0 })])(
  'malformed saved BTC configuration fails closed before connecting: %s',
  async saved => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(saved);
    Btc.selectWallet('blue');
    await expect(Btc.forWallet('blue').ensureConnected()).rejects.toThrow('settings could not be read');
    expect(mockClients).toHaveLength(0);
  },
);

test('a preference read failure cannot trigger a public connection', async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
  Btc.selectWallet('blue');
  await expect(Btc.forWallet('blue').ensureConnected()).rejects.toThrow('settings could not be read');
  expect(mockClients).toHaveLength(0);
});

test('saving an XBT endpoint as BTC is rejected without changing preferences or requesting an address', async () => {
  const probe = {
    initElectrum: jest.fn().mockResolvedValue({}),
    blockchainBlock_header: jest.fn().mockResolvedValue(XBT_MAINNET_CHECKPOINT_HEADER),
    blockchainHeaders_subscribe: jest.fn(),
    request: jest.fn(),
    close: jest.fn(),
  };
  require('electrum-client').mockImplementationOnce(() => probe);
  await expect(Btc.setPreferredServer({ host: 'xbt.example.com', ssl: 17717 })).rejects.toThrow('not on the Bitcoin SHA-256 chain');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(probe.request).not.toHaveBeenCalled();
  expect(probe.blockchainHeaders_subscribe).not.toHaveBeenCalled();
  expect(probe.close).toHaveBeenCalled();
});

test('a TLS connection failure preserves the saved endpoint', async () => {
  const probe = {
    initElectrum: jest.fn().mockRejectedValue(new Error('certificate expired')),
    close: jest.fn(),
  };
  require('electrum-client').mockImplementationOnce(() => probe);
  await expect(Btc.setPreferredServer({ host: 'private.server', ssl: 50002 })).rejects.toThrow('Could not verify');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(probe.close).toHaveBeenCalled();
});

test('a failed preference write keeps the current wallet session intact', async () => {
  Btc.selectWallet('blue');
  await Btc.forWallet('blue').ensureConnected();
  const active = mockClients[0];
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('write failed'));
  await expect(Btc.setPreferredServer({ host: 'private.server', ssl: 51002 })).rejects.toThrow('write failed');
  expect(active.close).not.toHaveBeenCalled();
  expect(Btc.getConnectionState()).toBe('connected');
  expect(mockClients[1].close).toHaveBeenCalled();
});

test('explicit return to default removes only the BTC preference and closes its session', async () => {
  Btc.selectWallet('blue');
  await Btc.forWallet('blue').ensureConnected();
  await Btc.resetPreferredServer();
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(Btc.BTC_SERVER_SETTINGS_KEY);
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1);
  expect(mockClients[0].close).toHaveBeenCalled();
  expect(Btc.getConnectionState()).toBe('selected');
  expect(await Btc.getPreferredServer()).toEqual(Btc.DEFAULT_BTC_SERVER);
});

test('a failed reset preserves the selected custom session', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ host: 'private.server', tcp: 51001 }));
  Btc.selectWallet('blue');
  await Btc.forWallet('blue').ensureConnected();
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('write failed'));
  await expect(Btc.resetPreferredServer()).rejects.toThrow('write failed');
  expect(mockClients[0].close).not.toHaveBeenCalled();
  expect(await Btc.getPreferredServer()).toEqual({
    host: 'private.server',
    tcp: 51001,
  });
});

test('a deliberately configured TCP server stays TCP and does not write XBT settings', async () => {
  await Btc.setPreferredServer({ host: '192.168.1.20', tcp: 50001 });
  expect(require('electrum-client')).toHaveBeenCalledWith(expect.anything(), expect.anything(), 50001, '192.168.1.20', 'tcp', undefined);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(Btc.BTC_SERVER_SETTINGS_KEY, JSON.stringify({ host: '192.168.1.20', tcp: 50001 }));
});

test('explicitly trusted PEM is normalized and passed with TLS verification still enabled', async () => {
  const pem = '-----BEGIN CERTIFICATE-----\nY2VydA==\n-----END CERTIFICATE-----';
  await Btc.setPreferredServer({
    host: 'private.server',
    ssl: 50002,
    tlsCa: pem.replace(/-----/g, '\u2014\u2014'),
  });
  expect(require('electrum-client')).toHaveBeenCalledWith(expect.anything(), expect.anything(), 50002, 'private.server', 'tls', {
    rejectUnauthorized: true,
    ca: pem,
  });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    Btc.BTC_SERVER_SETTINGS_KEY,
    JSON.stringify({ host: 'private.server', ssl: 50002, tlsCa: pem }),
  );
});

test.each([
  { host: 'https://btc.example.com', ssl: 50002 },
  { host: 'user@btc.example.com', ssl: 50002 },
  { host: 'btc.example.com:50002', ssl: 50002 },
  { host: 'bad.onion', tcp: 50001 },
  { host: ':::', ssl: 50002 },
  { host: 'btc.example.com', ssl: 65536 },
  { host: 'btc.example.com', ssl: 50002, tcp: 50001 },
  { host: 'btc.example.com', ssl: 50002, tlsCa: 'not a certificate' },
  {
    host: 'btc.example.com',
    tcp: 50001,
    tlsCa: '-----BEGIN CERTIFICATE-----\nY2VydA==\n-----END CERTIFICATE-----',
  },
])('rejects invalid configuration before any network or preference write: %j', server => {
  expect(() => Btc.setPreferredServer(server)).toThrow();
  expect(mockClients).toHaveLength(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('IPv6 literals are normalized without treating the literal as a host and port pair', () => {
  expect(Btc.validateServerConfiguration({ host: '[2001:db8::1]', ssl: 50002 })).toEqual({ host: '2001:db8::1', ssl: 50002 });
});

test('a connection awaiting preferences cannot start after wallet deselection', async () => {
  let finish!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  Btc.selectWallet('blue');
  const pending = Btc.forWallet('blue').ensureConnected();
  Btc.selectWallet();
  finish(null);
  expect(await pending).toBe(false);
  expect(mockClients).toHaveLength(0);
});

test('server configuration changes are serialized, so the most recent explicit choice wins', async () => {
  const stored = new Map<string, string>();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => stored.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  let finish!: (value: object) => void;
  require('electrum-client').mockImplementationOnce(() => {
    const client = {
      initElectrum: jest.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      ),
      blockchainBlock_header: jest.fn().mockResolvedValue(mockHeader),
      blockchainHeaders_subscribe: jest.fn().mockResolvedValue({ height: 981000 }),
      close: jest.fn(),
    };
    mockClients.push(client);
    return client;
  });
  const first = Btc.setPreferredServer({ host: 'first.server', ssl: 50002 });
  const last = Btc.setPreferredServer({ host: 'last.server', ssl: 51002 });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(mockClients).toHaveLength(1);
  finish({});
  await Promise.all([first, last]);
  expect(await Btc.getPreferredServer()).toEqual({
    host: 'last.server',
    ssl: 51002,
  });
});

test('refreshes UTXO tip and retries a block arriving between tip and listunspent', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  mockClients[0].blockchainHeaders_subscribe.mockResolvedValueOnce({ height: 981001 }).mockResolvedValue({ height: 981002 });
  mockClients[0].request.mockResolvedValue([{ tx_hash: '12'.repeat(32), tx_pos: 0, value: 1200, height: 981002 }]);
  const result = await backend.multiGetUtxoByAddress([address]);
  expect(result[address][0].confirmations).toBe(1);
  mockClients[0].request.mockResolvedValue([{ tx_hash: '12'.repeat(32), tx_pos: 0, value: 1200, height: 981003 }]);
  await expect(backend.multiGetUtxoByAddress([address])).rejects.toThrow('Invalid Bitcoin UTXO');
});

test('verbose reads follow confirmation, tip growth and reorg without an address scan, including reconnect', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address), 1200n);
  let height = 0;
  let chainTip = 981000;
  const setup = async () => {
    await backend.ensureConnected();
    const active = mockClients[mockClients.length - 1];
    active.blockchainHeaders_subscribe.mockImplementation(async () => ({
      height: chainTip,
    }));
    active.request.mockImplementation(async (method: string) => {
      if (method === 'blockchain.transaction.get') return tx.toHex();
      if (method === 'blockchain.scripthash.get_history') return [{ tx_hash: tx.getId(), height }];
      if (method === 'blockchain.block.header') return mockHeader;
      throw new Error(method);
    });
  };
  const confirmations = async () => (await backend.multiGetTransactionByTxid([tx.getId()], true))[tx.getId()].confirmations;
  await setup();
  expect(await confirmations()).toBe(0);
  height = ++chainTip;
  expect(await confirmations()).toBe(1);
  chainTip += 2;
  expect(await confirmations()).toBe(3);
  Btc.forceDisconnect();
  await setup();
  expect(await confirmations()).toBe(3);
  height = 0; // Removed from a block: cached history must not keep it confirmed.
  expect(await confirmations()).toBe(0);
});

test('a wallet switch during tip refresh cannot make an old UTXO read continue', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  let finish!: (value: unknown) => void;
  mockClients[0].blockchainHeaders_subscribe.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const pending = backend.multiGetUtxoByAddress([address]);
  Btc.selectWallet('other');
  finish({ height: 981002 });
  await expect(pending).rejects.toThrow();
  expect(mockClients[0].request).not.toHaveBeenCalled();
});

const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ownedHash = Buffer.from(bitcoin.crypto.sha256(bitcoin.address.toOutputScript(address)))
  .reverse()
  .toString('hex');
function statusTransaction(seed: number, ownOutput = true) {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, seed), 0);
  tx.addOutput(bitcoin.address.toOutputScript(recipient), 1000n);
  if (ownOutput) tx.addOutput(bitcoin.address.toOutputScript(address), 2000n);
  return tx;
}
test('confirmation lookup uses an owned output and shares history reads across a batch', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  const txs = [statusTransaction(4), statusTransaction(5)];
  mockClients[0].request.mockImplementation(async (method: string, params: any[]) => {
    if (method === 'blockchain.transaction.get') return txs.find(tx => tx.getId() === params[0])!.toHex();
    if (method === 'blockchain.block.header') return mockHeader;
    if (method === 'blockchain.scripthash.get_history' && params[0] === ownedHash)
      return txs.map(tx => ({ tx_hash: tx.getId(), height: 981000 }));
    throw new Error('Unexpected third-party history lookup');
  });
  const result = await backend.multiGetTransactionByTxid(
    txs.map(tx => tx.getId()),
    true,
  );
  expect(Object.values(result).map(tx => tx.confirmations)).toEqual([1, 1]);
  expect(mockClients[0].request.mock.calls.filter((call: unknown[]) => call[0] === 'blockchain.scripthash.get_history')).toEqual([
    ['blockchain.scripthash.get_history', [ownedHash]],
  ]);
});
test('decodes third-party parent transactions without querying their scripts', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  const tx = statusTransaction(6, false);
  mockClients[0].request.mockImplementation(async (method: string) => {
    if (method === 'blockchain.transaction.get') return tx.toHex();
    throw new Error('Third-party history is too large');
  });
  const result = await backend.multiGetTransactionByTxid([tx.getId()], true);
  expect(result[tx.getId()].confirmations).toBe(0);
  expect(result[tx.getId()].vout[0].value).toBe(0.00001);
  expect(mockClients[0].request).toHaveBeenCalledTimes(1);
});
test.each(['oversized', 'invalid'])('unknown owned-script status (%s) cannot fail unrelated raw transaction decoding', async mode => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  const tx = statusTransaction(7);
  mockClients[0].request.mockImplementation(async (method: string) => {
    if (method === 'blockchain.transaction.get') return tx.toHex();
    if (mode === 'oversized') throw new Error('History is too large');
    return [{ tx_hash: tx.getId(), height: 1.5 }];
  });
  const result = await backend.multiGetTransactionByTxid([tx.getId()], true);
  expect(result[tx.getId()].confirmations).toBe(0);
  expect(result[tx.getId()].rawHex).toBe(tx.toHex());
  await expect(backend.multiGetTransactionByTxid(['00'.repeat(32)], true)).rejects.toThrow('does not match');
});
test('outgoing transactions without change refresh an owned input history after reconnect', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  const tx = statusTransaction(8, false);
  let height = 0;
  const setup = async () => {
    await backend.ensureConnected();
    const active = mockClients[mockClients.length - 1];
    active.request.mockImplementation(async (method: string, params: any[]) => {
      if (method === 'blockchain.transaction.get') return tx.toHex();
      if (method === 'blockchain.block.header') return mockHeader;
      if (method === 'blockchain.scripthash.get_history' && params[0] === ownedHash) return [{ tx_hash: tx.getId(), height }];
      throw new Error('Unexpected third-party history lookup');
    });
  };
  await setup();
  await backend.getTransactionsByAddress(address);
  expect((await backend.multiGetTransactionByTxid([tx.getId()], true))[tx.getId()].confirmations).toBe(0);
  Btc.forceDisconnect();
  height = 981000;
  await setup();
  expect((await backend.multiGetTransactionByTxid([tx.getId()], true))[tx.getId()].confirmations).toBe(1);
});
test('a failed history reply after changing wallet cannot be masked as unknown confirmation', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue', () => [address]);
  await backend.ensureConnected();
  const tx = statusTransaction(9);
  mockClients[0].request.mockImplementation(async (method: string) => {
    if (method === 'blockchain.transaction.get') return tx.toHex();
    Btc.selectWallet('other');
    throw new Error('Interrupted');
  });
  await expect(backend.multiGetTransactionByTxid([tx.getId()], true)).rejects.toThrow('Select the blue BTC wallet');
});
