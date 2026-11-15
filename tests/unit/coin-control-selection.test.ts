import { availableCoinSelection } from '../../blue_modules/coin-control-selection';
import type { Utxo } from '../../class/wallets/types';

const coin = {
  txid: 'ab'.repeat(32),
  vout: 0,
  value: 10000,
  address: 'address',
  height: 100,
} as Utxo;
test('uses current wallet outputs and rejects frozen, reserved, spent or duplicate selections', () => {
  const current = { ...coin, confirmations: 6 };
  let frozen = false;
  let available = [current];
  const wallet = {
    getUtxo: () => available,
    getUTXOMetadata: () => ({ frozen }),
  };
  expect(availableCoinSelection(wallet, [coin])[0]).toBe(current);
  frozen = true;
  expect(() => availableCoinSelection(wallet, [coin])).toThrow('frozen');
  frozen = false;
  available = []; // Reservation or spending removes the output from spendable UTXOs.
  expect(() => availableCoinSelection(wallet, [coin])).toThrow('no longer available');
  available = [current];
  expect(() => availableCoinSelection(wallet, [coin, coin])).toThrow('Select available coins');
  expect(() => availableCoinSelection(wallet, [])).toThrow('Select available coins');
});
