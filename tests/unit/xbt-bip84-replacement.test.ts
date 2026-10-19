import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtBip84Transaction } from '../../class/xbt-bip84-transaction';

import ecc from '../../blue_modules/noble_ecc';
import { assertSignedUnifiedTransactionMatchesPsbt } from '../../class/xbt/unified-psbt';
import * as bitcoin from 'bitcoinjs-lib';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { inspectBip84Original, planBip84Replacement } from '../../class/xbt/bip84-replacement';

jest.mock('../../blue_modules/BlueElectrum', () => ({ multiGetTransactionByTxid: jest.fn() }));

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
  return { wallet, original, parent, parents, plan, owns, isChange };
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

it.each([false, true])('constructs the exact authenticated replacement (unsigned=%s)', unsigned => {
  const { wallet, original, parent, plan } = fixture();
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([
    { txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 },
    { txid: original.getId(), rawHex: original.toHex(), confirmations: 0 },
  ] as any);
  const expected = plan();
  const result = wallet.createAuthenticatedRBFTransaction(original.getId(), 3, unsigned, 1);
  expect(result.fee).toBe(expected.fee);
  expect(result.psbt.txOutputs.map(output => ({ script: output.script, value: output.value }))).toEqual(expected.outputs);
  expect(result.psbt.txInputs[0].sequence).toBe(original.ins[0].sequence);
  if (unsigned) {
    expect(Buffer.from(result.psbt.data.inputs[0].bip32Derivation![0].masterFingerprint).toString('hex')).toBe('01000000');
    expect(result.tx).toBeUndefined();
  } else {
    const reviewed = wallet.createAuthenticatedRBFTransaction(original.getId(), 3, true).psbt;
    expect(() =>
      assertSignedUnifiedTransactionMatchesPsbt(result.tx!.toHex(), reviewed, (key, digest, sig) => ecc.verify(digest, key, sig)),
    ).not.toThrow();
    expect(result.tx!.ins[0].witness[0].at(-1)).toBe(0x21);
    expect(result.tx!.outs[0]).toEqual(original.outs[0]);
  }
  expect(wallet.allowRBF()).toBe(false);
});
it('refuses to build from an unknown original', () => {
  const { wallet, original } = fixture();
  expect(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3)).toThrow('known unconfirmed');
});

it.each([0, 1, 0x123, 0xffffffff])('provides signer-verifiable change metadata for fingerprint %s', fingerprint => {
  const { wallet, original, parent } = fixture();
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([
    { txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 },
    { txid: original.getId(), rawHex: original.toHex(), confirmations: 0 },
  ] as any);
  const result = wallet.createAuthenticatedRBFTransaction(original.getId(), 3, true, fingerprint);
  expect(result.psbt.data.outputs[0].bip32Derivation).toBeUndefined();
  const derivation = result.psbt.data.outputs[1].bip32Derivation![0];
  expect(derivation.path).toBe("m/84'/0'/0'/1/0");
  const expectedFingerprint = Buffer.alloc(4);
  expectedFingerprint.writeUInt32LE(fingerprint);
  expect(Buffer.from(derivation.masterFingerprint)).toEqual(expectedFingerprint);
  expect(bitcoin.payments.p2wpkh({ pubkey: derivation.pubkey }).output).toEqual(result.psbt.txOutputs[1].script);
});

it('rejects change metadata whose public key does not match the output script', () => {
  const { wallet, original, parent } = fixture();
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([
    { txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 },
    { txid: original.getId(), rawHex: original.toHex(), confirmations: 0 },
  ] as any);
  const getPublicKey = wallet._getPubkeyByAddress.bind(wallet);
  const source = wallet._getExternalAddressByIndex(0);
  jest
    .spyOn(wallet, '_getPubkeyByAddress')
    .mockImplementation(address => (wallet.addressIsChange(address) ? getPublicKey(source) : getPublicKey(address)));
  expect(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3, true)).toThrow('does not match output');
});

function enabledFixture() {
  const f = fixture();
  jest.spyOn(f.wallet, 'allowAuthenticatedRBF').mockReturnValue(true);
  jest.spyOn(f.wallet, 'getTransactions').mockReturnValue([
    { txid: f.parent.getId(), rawHex: f.parent.toHex(), confirmations: 100 },
    { txid: f.original.getId(), rawHex: f.original.toHex(), confirmations: 0 },
  ] as any);
  const adapter = new XbtBip84Transaction(f.original.getId(), f.wallet);
  return { ...f, adapter };
}

it('ignores malicious server recipients, amounts and fees when signing a replacement', async () => {
  const { original, adapter } = enabledFixture();
  (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockResolvedValue({
    [original.getId()]: {
      txid: original.getId(),
      confirmations: 0,
      fee: 0,
      vout: [{ value: 99999, scriptPubKey: { address: 'attacker' } }],
    },
  });
  const result = await adapter.createRBFbumpFee(3);
  expect(result.tx!.outs[0]).toEqual(original.outs[0]);
  expect(result.tx!.outs[1].value).toBeLessThan(original.outs[1].value);
  expect(result.tx!.outs[1].value).toBeGreaterThanOrEqual(294n);
  expect(result.tx!.ins[0].witness[0].at(-1)).toBe(0x21);
});

it.each([1, -1, 0.5, Number.NaN])('refuses remote confirmation state %s before signing', async confirmations => {
  const { wallet, original, adapter } = enabledFixture();
  const sign = jest.spyOn(wallet, 'createAuthenticatedRBFTransaction');
  (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockResolvedValue({
    [original.getId()]: { txid: original.getId(), confirmations },
  });
  await expect(adapter.createRBFbumpFee(3)).rejects.toThrow();
  expect(sign).not.toHaveBeenCalled();
});

it('rechecks local transaction state after the asynchronous remote check', async () => {
  const { wallet, original, adapter, parent } = enabledFixture();
  const sign = jest.spyOn(wallet, 'createAuthenticatedRBFTransaction');
  (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async () => {
    jest.spyOn(wallet, 'getTransactions').mockReturnValue([
      { txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 },
      { txid: original.getId(), rawHex: original.toHex(), confirmations: 1 },
    ] as any);
    return { [original.getId()]: { txid: original.getId(), confirmations: 0 } };
  });
  await expect(adapter.createRBFbumpFee(3)).rejects.toThrow('known unconfirmed');
  expect(sign).not.toHaveBeenCalled();
});

it('authenticates signatures before reporting original fee information', () => {
  const { original, parents, owns } = fixture();
  const txid = original.getId();
  original.ins[0].witness[0][10] = (original.ins[0].witness[0][10] + 1) % 256;
  expect(() => inspectBip84Original(txid, original.toHex(), parents, owns)).toThrow();
});

it('rejects fee replacement of a CoinJoin-reserved input before accessing its key', async () => {
  const { Round } = await import('../../class/xbt/kilojoin/round');
  const { WalletJournalStore } = await import('../../class/xbt/kilojoin/wallet-store');
  const { wallet, original, parent } = fixture();
  jest
    .spyOn(wallet, 'getTransactions')
    .mockReturnValue([
      { txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 } as any,
      { txid: original.getId(), rawHex: original.toHex(), confirmations: 0 } as any,
    ]);
  await Round.join(wallet.getID(), 'ab'.repeat(8), [parent.getId() + ':0'], 100, 1, new WalletJournalStore(wallet, async () => {}));
  const keys = jest.spyOn(wallet, '_getWifForAddress');
  expect(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3)).toThrow('reserved');
  expect(keys).not.toHaveBeenCalled();
});
