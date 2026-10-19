import { address } from 'bitcoinjs-lib';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import {
  approvePrivacySelection,
  coinPrivacyStatus,
  combinesMixedCoins,
  selectPrivacyCoins,
  suggestCoinjoinCoins,
} from '../../class/xbt/coin-privacy';
import { WalletJournalStore } from '../../class/xbt/kilojoin/wallet-store';
import { Round } from '../../class/xbt/kilojoin/round';

const destination = address.fromOutputScript(Buffer.from('0014' + '55'.repeat(20), 'hex'));
const coin = (byte: string, value: number, confirmations = 3) => ({
  txid: byte.repeat(64),
  vout: 0,
  value,
  confirmations,
  address: destination,
});
const a = coin('1', 15000),
  b = coin('2', 30000),
  c = coin('3', 6000);
function mixed(wallet: XbtSegwitBech32Wallet | XbtTaprootWallet, input = a, role: 'mixed' | 'change' = 'mixed') {
  wallet.setUTXOMetadata(input.txid, input.vout, { coinjoin: { version: 1, role, txid: input.txid } });
}

test('mixing history survives serialization and memo/freeze edits; a seed-only wallet stays unknown', () => {
  const wallet = new XbtSegwitBech32Wallet();
  mixed(wallet);
  wallet.setUTXOMetadata(a.txid, 0, { memo: 'Personal note', frozen: true });
  const restored = XbtSegwitBech32Wallet.fromJson(JSON.stringify(wallet));
  expect(coinPrivacyStatus(restored, a)).toBe('mixed');
  expect(restored.getUTXOMetadata(a.txid, 0)).toMatchObject({ memo: 'Personal note', frozen: true });
  expect(coinPrivacyStatus(new XbtSegwitBech32Wallet(), a)).toBe('unknown');
});

test('does not infer mixed status from editable text, foreign metadata, or a missing confirmation', () => {
  const wallet = new XbtSegwitBech32Wallet();
  wallet.setUTXOMetadata(a.txid, 0, { memo: 'CoinJoin output · Kilojoin' });
  expect(coinPrivacyStatus(wallet, a)).toBe('unknown');
  expect(() => wallet.setUTXOMetadata(a.txid, 0, { coinjoin: { version: 1, role: 'mixed', txid: b.txid } })).toThrow();
  mixed(wallet);
  for (const confirmations of [0, -1, NaN, undefined]) expect(coinPrivacyStatus(wallet, { ...a, confirmations })).toBe('pending');
  expect(combinesMixedCoins(wallet, [{ ...a, confirmations: 0 }, b])).toBe(true);
});

test.each([XbtSegwitBech32Wallet, XbtTaprootWallet])('fee-aware %s selection avoids combining categories when either can pay', Wallet => {
  const wallet = new Wallet();
  mixed(wallet);
  const targets = [{ address: destination, value: 10000 }];
  const selected = selectPrivacyCoins(wallet, [a, b], targets, 2);
  expect(selected.coins).toHaveLength(1);
  expect(selected.warning).toBe(false);
  expect(selected.coins.reduce((sum, input) => sum + input.value, 0)).toBeGreaterThanOrEqual(10000 + selected.fee);
  expect([a, b]).toEqual([coin('1', 15000), coin('2', 30000)]);
});

test('combines only when a category cannot cover amount plus fee; denial stops progression', async () => {
  const wallet = new XbtSegwitBech32Wallet();
  mixed(wallet, c);
  const other = coin('4', 4500);
  const selection = selectPrivacyCoins(wallet, [c, other], [{ address: destination, value: 10000 }], 1);
  expect(selection.coins).toHaveLength(2);
  expect(selection.warning).toBe(true);
  const sign = jest.fn(),
    confirm = jest.fn(async () => false);
  if (await approvePrivacySelection(wallet, selection.coins, confirm)) sign();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(sign).not.toHaveBeenCalled();
  expect(await approvePrivacySelection(wallet, selection.coins, async () => true)).toBe(true);
  expect(await approvePrivacySelection(wallet, [c], confirm)).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(1);
});

test('mixed plus change warns even after deliberate unfreezing; unknown-only does not claim mixed', () => {
  const wallet = new XbtSegwitBech32Wallet();
  mixed(wallet);
  mixed(wallet, b, 'change');
  wallet.setUTXOMetadata(b.txid, 0, { frozen: false });
  expect(coinPrivacyStatus(wallet, b)).toBe('change');
  expect(combinesMixedCoins(wallet, [a, b])).toBe(true);
  expect(combinesMixedCoins(wallet, [b, c])).toBe(false);
});

test('MAX retains all eligible coins and flags recombination instead of silently sending a smaller amount', () => {
  const wallet = new XbtSegwitBech32Wallet();
  mixed(wallet);
  const selection = selectPrivacyCoins(wallet, [a, b], [{ address: destination }], 2);
  expect(selection.coins).toHaveLength(2);
  expect(selection.warning).toBe(true);
  expect(selectPrivacyCoins(wallet, [a], [{ address: destination }], 2, false).coins).toEqual([a]);
});

test('suggestions exclude frozen and reserved coins and manual choices cannot bypass those restrictions', async () => {
  const wallet = new XbtSegwitBech32Wallet();
  mixed(wallet);
  wallet.setUTXOMetadata(a.txid, 0, { frozen: true });
  await Round.join(wallet.getID(), 'ab'.repeat(8), [`${b.txid}:0`], 1000, 1, new WalletJournalStore(wallet, async () => {}));
  const selection = selectPrivacyCoins(wallet, [a, b, c], [{ address: destination, value: 1000 }], 1);
  expect(selection.coins).toEqual([c]);
  expect(() => selectPrivacyCoins(wallet, [a], [{ address: destination, value: 1000 }], 1, false)).toThrow('Unfreeze');
  expect(() => selectPrivacyCoins(wallet, [b], [{ address: destination, value: 1000 }], 1, false)).toThrow('Unfreeze');
});

test('selector errors and insufficient total balance cannot become a spending suggestion', () => {
  const wallet = new XbtSegwitBech32Wallet();
  expect(() => selectPrivacyCoins(wallet, [c], [{ address: destination, value: 6000 }], 2)).toThrow('Not enough balance');
  jest.spyOn(wallet, 'coinselect').mockImplementation(() => {
    throw new Error('Invalid recipient');
  });
  expect(() => selectPrivacyCoins(wallet, [c], [{ address: destination, value: 1000 }], 2)).toThrow('Invalid recipient');
});

test('pool suggestions respect confirmation, fee cap and input limit while keeping histories separate', () => {
  const wallet = new XbtSegwitBech32Wallet();
  mixed(wallet);
  const terms = { denomination: 10000, fee_rate: 2, script: 'p2wpkh' as const, max_inputs: 2 };
  expect(suggestCoinjoinCoins(wallet, [a, b], terms, 1000)).toHaveLength(1);
  expect(() => suggestCoinjoinCoins(wallet, [a, b], terms, 1)).toThrow('No eligible');
  expect(() => suggestCoinjoinCoins(wallet, [{ ...a, confirmations: 0 }], terms, 1000)).toThrow('No eligible');
  wallet.setUTXOMetadata(a.txid, 0, { frozen: true });
  expect(suggestCoinjoinCoins(wallet, [a, b], terms, 1000)).toEqual([b]);
  const d = coin('4', 5000);
  mixed(wallet, c);
  expect(suggestCoinjoinCoins(wallet, [c, d], terms, 1000)).toHaveLength(2);
  expect(combinesMixedCoins(wallet, suggestCoinjoinCoins(wallet, [c, d], terms, 1000))).toBe(true);
  expect(() => suggestCoinjoinCoins(wallet, [c, d], { ...terms, max_inputs: 1 }, 1000)).toThrow('No eligible');
});
