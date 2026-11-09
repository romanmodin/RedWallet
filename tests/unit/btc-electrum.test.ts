import * as bitcoin from 'bitcoinjs-lib';
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
  const backend = Btc.forWallet('blue');
  expect(await backend.ensureConnected()).toBe(false);
  await expect(backend.getBalanceByAddress(address)).rejects.toThrow('Select the blue BTC wallet');
  expect(mockClients).toHaveLength(0);
});
test('uses authenticated TLS and only the selected blue wallet session', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue');
  expect(await backend.ensureConnected()).toBe(true);
  expect(require('electrum-client')).toHaveBeenCalledWith(expect.anything(), expect.anything(), 50002, 'electrum.blockstream.info', 'tls', {
    rejectUnauthorized: true,
  });
  mockClients[0].request.mockResolvedValue({ confirmed: 1000, unconfirmed: 0 });
  expect(await backend.getBalanceByAddress(address)).toEqual({ confirmed: 1000, unconfirmed: 0 });
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
  const client = { initElectrum: () => pending, blockchainBlock_header: jest.fn(), close: jest.fn() };
  require('electrum-client').mockImplementationOnce(() => client);
  Btc.selectWallet('blue');
  const connecting = Btc.forWallet('blue').ensureConnected();
  Btc.selectWallet();
  finish({});
  expect(await connecting).toBe(false);
  expect(client.close).toHaveBeenCalled();
  expect(client.blockchainBlock_header).not.toHaveBeenCalled();
  expect(Btc.getConnectionState()).toBe('inactive');
});
test.each([NaN, -1, 2_100_000_000_000_001, 1.5])('rejects a malformed confirmed balance: %s', async value => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue');
  await backend.ensureConnected();
  mockClients[0].request.mockResolvedValue({ confirmed: value, unconfirmed: 0 });
  await expect(backend.getBalanceByAddress(address)).rejects.toThrow('Invalid Bitcoin amount');
});
test('verifies raw transaction IDs instead of trusting verbose server amounts', async () => {
  Btc.selectWallet('blue');
  const backend = Btc.forWallet('blue');
  await backend.ensureConnected();
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address), 1200n);
  mockClients[0].request.mockResolvedValue(tx.toHex());
  const result = await backend.multiGetTransactionByTxid([tx.getId()], true);
  expect(result[tx.getId()].vout[0].value).toBe(0.000012);
  expect(result[tx.getId()].rawHex).toBe(tx.toHex());
  await expect(backend.multiGetTransactionByTxid(['22'.repeat(32)], true)).rejects.toThrow('does not match');
});
