import { discoverXbtRecovery } from '../../class/xbt/recovery-discovery';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetHistoryByAddress: jest.fn(),
}));
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const tx = { tx_hash: 'a'.repeat(64), height: 1 };
const historyMock = BlueElectrum.multiGetHistoryByAddress as jest.Mock;
let used: Set<string>;
const collect = async (options = {}, running = () => true) => {
  const wallets = [];
  for await (const result of discoverXbtRecovery(seed, 'test', options, running)) if (result.wallet) wallets.push(result.wallet);
  return wallets;
};
const address = (Wallet: typeof XbtSegwitBech32Wallet | typeof XbtTaprootWallet, account: number, index: number, change = false) => {
  const wallet = new Wallet();
  wallet.setSecret(seed);
  wallet.setPassphrase('test');
  wallet.setDerivationPath(`m/${Wallet === XbtTaprootWallet ? 86 : 84}'/0'/${account}'`);
  return change ? wallet._getInternalAddressByIndex(index) : wallet._getExternalAddressByIndex(index);
};
beforeEach(() => {
  used = new Set();
  historyMock.mockImplementation(async (addresses: string[]) => Object.fromEntries(addresses.map(a => [a, used.has(a) ? [tx] : []])));
  jest.spyOn(XbtSegwitBech32Wallet.prototype, 'fetchBalance').mockResolvedValue(undefined);
  jest.spyOn(XbtSegwitBech32Wallet.prototype, 'fetchTransactions').mockResolvedValue(undefined);
  jest.spyOn(XbtTaprootWallet.prototype, 'fetchBalance').mockResolvedValue(undefined);
  jest.spyOn(XbtTaprootWallet.prototype, 'fetchTransactions').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('finds spent-out, change-only and nonzero accounts in both formats across empty accounts', async () => {
  used.add(address(XbtSegwitBech32Wallet, 2, 5, true));
  used.add(address(XbtTaprootWallet, 1, 3));
  const wallets = await collect();
  expect(wallets.map(w => w.getDerivationPath())).toEqual(["m/84'/0'/2'", "m/86'/0'/1'"]);
  expect(wallets[0].next_free_change_address_index).toBe(6);
  expect(wallets[1].next_free_address_index).toBe(4);
  expect(new Set(wallets.map(w => w.getID())).size).toBe(2);
});
test('advanced gap discovers activity beyond the default gap', async () => {
  used.add(address(XbtTaprootWallet, 0, 35));
  expect(await collect()).toHaveLength(0);
  const wallets = await collect({ gapLimit: 100 });
  expect(wallets).toHaveLength(1);
  expect(wallets[0].next_free_address_index).toBe(36);
});
test('history usage resets the gap', async () => {
  used.add(address(XbtSegwitBech32Wallet, 0, 19));
  used.add(address(XbtSegwitBech32Wallet, 0, 38));
  expect((await collect())[0].next_free_address_index).toBe(39);
});
test('missing and malformed responses fail instead of reporting an unused wallet', async () => {
  historyMock.mockResolvedValue({});
  await expect(collect()).rejects.toThrow('Incomplete or invalid');
  historyMock.mockImplementation(async (addresses: string[]) => Object.fromEntries(addresses.map(a => [a, [{ ...tx, tx_hash: 'bad' }]])));
  await expect(collect()).rejects.toThrow('Incomplete or invalid');
});
test('server errors propagate', async () => {
  historyMock.mockRejectedValue(new Error('Server unavailable'));
  await expect(collect()).rejects.toThrow('Server unavailable');
});
test('cancellation during a history request cannot report or fetch a wallet', async () => {
  let running = true;
  historyMock.mockImplementation(async (addresses: string[]) => {
    running = false;
    return Object.fromEntries(addresses.map(a => [a, [tx]]));
  });
  await expect(collect({}, () => running)).rejects.toThrow('Discovery stopped');
  expect(XbtSegwitBech32Wallet.prototype.fetchBalance).not.toHaveBeenCalled();
});
test('rejects unbounded or unsupported scan limits', async () => {
  await expect(collect({ gapLimit: 100000 })).rejects.toThrow('Invalid recovery scan limits');
  await expect(collect({ accountLimit: 0 })).rejects.toThrow('Invalid recovery scan limits');
});

test('never claims a completed scan when every queried address remains used at the hard cap', async () => {
  jest.spyOn(XbtSegwitBech32Wallet.prototype, '_getExternalAddressByIndex').mockImplementation(index => `fixture-${index}`);
  historyMock.mockImplementation(async (addresses: string[]) => Object.fromEntries(addresses.map(a => [a, [tx]])));
  await expect(collect()).rejects.toThrow('recovery is incomplete');
  expect(XbtSegwitBech32Wallet.prototype.fetchBalance).not.toHaveBeenCalled();
});
