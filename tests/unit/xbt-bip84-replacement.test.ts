import * as bitcoin from 'bitcoinjs-lib';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { planBip84Replacement } from '../../class/xbt/bip84-replacement';

function fixture() {
  const wallet = new XbtSegwitBech32Wallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const source = wallet._getExternalAddressByIndex(0);
  const destination = wallet._getExternalAddressByIndex(1);
  const change = wallet._getInternalAddressByIndex(0);
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, 1), 0);
  parent.addOutput(bitcoin.address.toOutputScript(source), 100_000n);
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([{ txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 } as any]);
  const original = wallet.createTransaction(
    [{ txid: parent.getId(), vout: 0, address: source, value: 100_000, confirmations: 100 }],
    [{ address: destination, value: 50_000 }],
    1,
    change,
    0xfffffffd,
  ).tx!;
  const parents = new Map([[parent.getId(), parent.toHex()]]);
  const owns = (script: Uint8Array) => wallet.weOwnAddress(bitcoin.address.fromOutputScript(script));
  const isChange = (script: Uint8Array) => wallet.addressIsChange(bitcoin.address.fromOutputScript(script));
  const expectedTxid = original.getId();
  const plan = (raw = original.toHex(), rate = 3) => planBip84Replacement(expectedTxid, raw, parents, rate, owns, isChange);
  return { original, parent, parents, plan, owns, isChange };
}

it('preserves recipients and pays the increase only from change above dust', () => {
  const { original, plan } = fixture();
  const result = plan();
  expect(result.outputs[0]).toEqual(original.outs[0]);
  expect(result.outputs[1].value).toBeGreaterThanOrEqual(294n);
  expect(result.outputs[1].value).toBeLessThan(original.outs[1].value);
  expect(100_000n - result.outputs.reduce((sum, output) => sum + output.value, 0n)).toBe(BigInt(result.fee));
});
it('rejects a redirected original before planning a replacement', () => {
  const { original, plan } = fixture();
  original.outs[0].script = bitcoin.address.toOutputScript('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
  expect(() => plan(original.toHex())).toThrow();
});
it('rejects invalid witness signatures even when the txid is unchanged', () => {
  const { original, plan } = fixture();
  original.ins[0].witness[0][10] = (original.ins[0].witness[0][10] + 1) % 256;
  expect(() => plan(original.toHex())).toThrow();
});
it('rejects a Bitcoin sighash flag', () => {
  const { original, plan } = fixture();
  const signature = original.ins[0].witness[0];
  signature[signature.length - 1] = 1;
  expect(() => plan(original.toHex())).toThrow('0x21');
});
it('rejects falsified parent amounts', () => {
  const { parent, parents, plan } = fixture();
  const id = parent.getId();
  parent.outs[0].value += 100_000n;
  parents.set(id, parent.toHex());
  expect(() => plan()).toThrow('requested txid');
});
it.each([1, 10000, NaN, Infinity, -1])('refuses insufficient increment, insufficient change or invalid rate %s', rate => {
  const { plan } = fixture();
  expect(() => plan(undefined, rate)).toThrow();
});
