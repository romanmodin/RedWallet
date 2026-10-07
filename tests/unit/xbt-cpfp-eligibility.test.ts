import * as bitcoin from 'bitcoinjs-lib';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { cpfpNeedsApproval } from '../native/fee-bump-review';

function fixture() {
  const wallet = new XbtSegwitBech32Wallet();
  const address = bitcoin.address.toBech32(Buffer.alloc(20, 1), 0, 'bc');
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, 2), 0);
  parent.addOutput(bitcoin.address.toOutputScript(address), 10_000n);
  const utxo = { txid: parent.getId(), vout: 0, address, value: 10_000 };
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([{ txid: parent.getId(), value: -90_000 } as any]);
  jest.spyOn(wallet, 'getUtxo').mockReturnValue([utxo] as any);
  jest.spyOn(wallet, 'weOwnAddress').mockImplementation(value => value === address);
  const transaction = new HDSegwitBech32Transaction(parent.toHex(), parent.getId(), wallet);
  return { wallet, parent, utxo, transaction };
}

test('outgoing XBT SegWit change remains eligible for CPFP', async () => {
  expect(await fixture().transaction.isToUsTransaction()).toBe(true);
});

test('spent change is not eligible even when history shows a positive value', async () => {
  const { wallet, transaction } = fixture();
  (wallet.getTransactions as jest.Mock).mockReturnValue([{ value: 10_000 }]);
  (wallet.getUtxo as jest.Mock).mockReturnValue([]);
  expect(await transaction.isToUsTransaction()).toBe(false);
});

test.each(['txid', 'value', 'vout', 'address'])('rejects a mismatched %s in a candidate change output', async key => {
  const { transaction, utxo } = fixture();
  Object.assign(utxo, {
    [key]: {
      txid: '00'.repeat(32),
      value: 9_999,
      vout: 9,
      address: bitcoin.address.toBech32(Buffer.alloc(20, 3), 0, 'bc'),
    }[key],
  });
  expect(await transaction.isToUsTransaction()).toBe(false);
});

test('rejects an owned address whose script differs from the parent output', async () => {
  const { wallet, transaction, utxo } = fixture();
  (wallet.weOwnAddress as jest.Mock).mockReturnValue(true);
  utxo.address = bitcoin.address.toBech32(Buffer.alloc(20, 3), 0, 'bc');
  expect(await transaction.isToUsTransaction()).toBe(false);
});

test('rejects a substituted parent transaction', async () => {
  const { wallet, parent } = fixture();
  const transaction = new HDSegwitBech32Transaction(parent.toHex(), '00'.repeat(32), wallet);
  await expect(transaction.isToUsTransaction()).rejects.toThrow('identity mismatch');
});

test.each([
  [9_900n, false],
  [9_000n, true],
])('derives high-fee approval from parent inputs and child outputs (%s)', (value, approval) => {
  const { parent } = fixture();
  const child = new bitcoin.Transaction();
  child.addInput(Buffer.from(parent.getId(), 'hex').reverse(), 0);
  child.setWitness(0, [Buffer.alloc(65)]);
  child.addOutput(parent.outs[0].script, value);
  expect(cpfpNeedsApproval(parent, child)).toBe(approval);
});

test('review calculation rejects unrelated inputs and duplicate outpoints', () => {
  const { parent } = fixture();
  const child = new bitcoin.Transaction();
  child.addInput(Buffer.alloc(32, 4), 0);
  child.addOutput(parent.outs[0].script, 9_000n);
  expect(() => cpfpNeedsApproval(parent, child)).toThrow();
  child.ins[0].hash = Buffer.from(parent.getId(), 'hex').reverse();
  child.addInput(child.ins[0].hash, 0);
  expect(() => cpfpNeedsApproval(parent, child)).toThrow('duplicate');
});
