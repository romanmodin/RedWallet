import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import acceptance from '../fixtures/xbt-taproot-knots-regtest-acceptance.json';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { unifiedTaprootKeyPathSighashAll } from '../../class/xbt/unified-sighash';
import { assertXbtUnifiedTransaction } from '../../class/xbt/broadcast-validation';
import { finalizeUnifiedTaprootInput, signUnifiedTaprootInput } from '../../class/xbt/unified-taproot-psbt';
import { buildUnsignedTransaction } from '../../class/xbt/unified-psbt';
import startImport from '../../class/wallet-import';

jest.mock('../../blue_modules/BlueElectrum', () => ({}));

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function funded(coinbase = false, confirmations = 100) {
  const wallet = new XbtTaprootWallet();
  wallet.setSecret(mnemonic);
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, coinbase ? 0 : 1), coinbase ? 0xffffffff : 0);
  const address = wallet._getExternalAddressByIndex(0);
  parent.addOutput(bitcoin.address.toOutputScript(address), 100_000n);
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([{ txid: parent.getId(), rawHex: parent.toHex(), confirmations }] as any);
  const utxo = { txid: parent.getId(), vout: 0, address, value: 100_000, confirmations };
  const change = wallet._getInternalAddressByIndex(0);
  const targets = [{ address: wallet._getExternalAddressByIndex(1), value: 50_000 }];
  const create = (skipSigning = false) => wallet.createTransaction([utxo], targets, 1, change, undefined, skipSigning);
  return { wallet, parent, utxo, change, targets, create };
}

describe('XBT BIP86 wallet', () => {
  it('replays the two-input signature accepted and mined by network-isolated Knots', () => {
    const wallet = new XbtTaprootWallet();
    wallet.setSecret(mnemonic);
    const parents = acceptance.fixture.fundingTransactions.map(funding => ({
      transaction: bitcoin.Transaction.fromHex(funding.rawTx),
      confirmations: funding.confirmations,
    }));
    jest.spyOn(wallet, 'getTransactions').mockReturnValue(
      parents.map(parent => ({
        txid: parent.transaction.getId(),
        rawHex: parent.transaction.toHex(),
        confirmations: parent.confirmations,
      })) as any,
    );
    const result = wallet.createTransaction(
      acceptance.signed.inputs,
      [{ address: acceptance.signed.destination.address, value: acceptance.signed.destination.value }],
      acceptance.signed.feeRateSatPerVbyte,
      acceptance.signed.change.address,
    );
    expect(result.tx!.toHex()).toBe(acceptance.signed.goodHex);
    expect(result.tx!.getId()).toBe(acceptance.node.confirmation.txid);
    expect(result.fee).toBe(acceptance.signed.feeSats);
    expect(acceptance.node.checks.good.allowed).toBe(true);
    expect(acceptance.node.checks.changedOutputHex.allowed).toBe(false);
    expect(acceptance.node.checks.removedUnifiedBitHex.allowed).toBe(false);
    expect(acceptance.node.networkactive).toBe(false);
    expect(acceptance.node.connections).toBe(0);
    const spentOutputs = result.tx!.ins.map(
      input =>
        parents.find(parent => parent.transaction.getId() === Buffer.from(input.hash).reverse().toString('hex'))!.transaction.outs[
          input.index
        ],
    );
    result.tx!.ins.forEach((input, index) => {
      // bitcoinjs independently computes the standard BIP341 digest: these XBT signatures must fail it.
      const bitcoinDigest = result.tx!.hashForWitnessV1(
        index,
        spentOutputs.map(output => output.script),
        spentOutputs.map(output => output.value),
        bitcoin.Transaction.SIGHASH_ALL,
      );
      expect(ecc.verifySchnorr!(bitcoinDigest, spentOutputs[index].script.subarray(2), input.witness[0].subarray(0, 64))).toBe(false);
    });
  });
  it('matches the independent BIP86 addresses and survives JSON recovery with a distinct BIP84 identity', () => {
    const { wallet } = funded();
    expect(wallet._getExternalAddressByIndex(0)).toBe('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
    expect(wallet._getInternalAddressByIndex(0)).toBe('bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7');
    const restored = XbtTaprootWallet.fromJson(JSON.stringify(wallet)) as unknown as XbtTaprootWallet;
    expect(restored.getID()).toBe(wallet.getID());
    expect(restored.getDerivationPath()).toBe("m/86'/0'/0'");
    expect(restored._getExternalAddressByIndex(1)).toBe(wallet._getExternalAddressByIndex(1));
    const segwit = new XbtSegwitBech32Wallet();
    segwit.setSecret(mnemonic);
    expect(wallet.getID()).not.toBe(segwit.getID());
    expect(wallet.allowRBF()).toBe(true);
    expect(wallet.allowCosignPsbt()).toBe(false);
    expect(wallet.allowSilentPaymentSend()).toBe(false);
  });

  it('recovers the selected BIP86 account and optional BIP39 passphrase', async () => {
    const { promise } = startImport(
      mnemonic,
      true,
      false,
      true,
      () => {},
      () => {},
      async () => 'TREZOR',
      true,
      'taproot',
    );
    const result = await promise;
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0]).toBeInstanceOf(XbtTaprootWallet);
    const recovered = result.wallets[0] as XbtTaprootWallet;
    const expected = new XbtTaprootWallet();
    expected.setSecret(mnemonic);
    expected.setPassphrase('TREZOR');
    expect(recovered.getID()).toBe(expected.getID());
    expect(recovered._getExternalAddressByIndex(0)).toBe(expected._getExternalAddressByIndex(0));
  });

  it.each([1, 2.5, 10])('signs verifiable 0x21 Schnorr witnesses and pays at least %s sat/vB', rate => {
    const { wallet, parent, utxo, targets, change } = funded();
    const result = wallet.createTransaction([utxo], targets, rate, change);
    const tx = result.tx!;
    expect(tx.ins[0].witness).toHaveLength(1);
    const signature = tx.ins[0].witness[0];
    expect(signature).toHaveLength(65);
    expect(signature[64]).toBe(0x21);
    const digest = unifiedTaprootKeyPathSighashAll(tx, 0, [parent.outs[0]]);
    expect(ecc.verifySchnorr!(digest, parent.outs[0].script.subarray(2), signature.subarray(0, 64))).toBe(true);
    expect(result.fee / tx.virtualSize()).toBeGreaterThanOrEqual(rate);
    expect(bitcoin.Psbt.fromBase64(result.psbt.toBase64()).extractTransaction().toHex()).toBe(tx.toHex());
    expect(() => assertXbtUnifiedTransaction(tx.toHex())).not.toThrow();
    tx.outs[0].value -= 1n;
    expect(
      ecc.verifySchnorr!(
        unifiedTaprootKeyPathSighashAll(tx, 0, [parent.outs[0]]),
        parent.outs[0].script.subarray(2),
        signature.subarray(0, 64),
      ),
    ).toBe(false);
  });

  it('prices send-all and omits dust change without reducing the reviewed recipient amount', () => {
    const { wallet, utxo, targets, change } = funded();
    const max = wallet.createTransaction([utxo], [{ address: targets[0].address }], 1, change);
    expect(max.tx!.outs).toHaveLength(1);
    expect(max.fee / max.tx!.virtualSize()).toBeGreaterThanOrEqual(1);
    const dust = wallet.createTransaction([utxo], [{ address: targets[0].address, value: 99_540 }], 1, change);
    expect(dust.tx!.outs).toHaveLength(1);
    expect(dust.tx!.outs[0].value).toBe(99_540n);
    expect(dust.fee).toBe(460);
  });

  it('declares Unified on unsigned PSBTs and rejects a wrong key, script path, and invalid signature', () => {
    const { create } = funded();
    const psbt = bitcoin.Psbt.fromBase64(create(true).psbt.toBase64());
    expect(psbt.data.inputs[0].sighashType).toBe(0x21);
    expect(psbt.data.inputs[0].tapInternalKey).toHaveLength(32);
    expect(() => signUnifiedTaprootInput(psbt, 0, { publicKey: Buffer.alloc(32), sign: () => Buffer.alloc(64) })).toThrow(
      'Signing key does not match',
    );
    const scripted = psbt.clone();
    scripted.data.inputs[0].tapMerkleRoot = Buffer.alloc(32, 1);
    expect(() => signUnifiedTaprootInput(scripted, 0, { publicKey: Buffer.alloc(32), sign: () => Buffer.alloc(64) })).toThrow('Only BIP86');
    const key = psbt.data.inputs[0].witnessUtxo!.script.subarray(2);
    signUnifiedTaprootInput(psbt, 0, { publicKey: key, sign: () => Buffer.alloc(64) });
    expect(() =>
      finalizeUnifiedTaprootInput(psbt, 0, (pubkey, digest, signature) => ecc.verifySchnorr!(digest, pubkey, signature)),
    ).toThrow('signature is invalid');
    expect(() => signUnifiedTaprootInput(psbt, 0, { publicKey: key, sign: () => Buffer.alloc(64) })).toThrow('overwrite');
  });

  it('rejects Bitcoin default signatures, a removed Unified bit, and annexes before broadcast', () => {
    for (const mutation of ['default', 'bitcoin', 'annex']) {
      const tx = funded().create().tx!;
      if (mutation === 'default') tx.ins[0].witness[0] = tx.ins[0].witness[0].subarray(0, 64);
      if (mutation === 'bitcoin') tx.ins[0].witness[0][64] = 1;
      if (mutation === 'annex') tx.ins[0].witness.push(Buffer.from([0x50]));
      expect(() => assertXbtUnifiedTransaction(tx.toHex())).toThrow();
    }
  });

  it.each([0, 100, 6479])('rejects immature coinbase at %i confirmations', confirmations => {
    const { wallet, utxo, create } = funded(true, confirmations);
    wallet._utxo = [utxo];
    expect(wallet.getUtxo()).toHaveLength(0);
    expect(create).toThrow('6480 confirmations');
  });

  it('accepts mature coinbase and rejects missing or altered prevouts and foreign change', () => {
    expect(funded(true, 6480).create().tx).toBeDefined();
    const { wallet, utxo, targets, change } = funded();
    expect(() => wallet.createTransaction([{ ...utxo, value: utxo.value + 1 }], targets, 1, change)).toThrow('raw parent');
    expect(() => wallet.createTransaction([utxo], targets, 1, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toThrow('change address');
    jest.spyOn(wallet, 'getTransactions').mockReturnValue([]);
    expect(() => wallet.createTransaction([utxo], targets, 1, change)).toThrow('Cannot verify');
  });

  it('commits every input amount/script, sequence, version, locktime and output', () => {
    const psbt = funded().create(true).psbt;
    const tx = buildUnsignedTransaction(psbt);
    const output = psbt.data.inputs[0].witnessUtxo!;
    const digest = unifiedTaprootKeyPathSighashAll(tx, 0, [output]);
    expect(unifiedTaprootKeyPathSighashAll(tx, 0, [{ ...output, value: output.value + 1n }])).not.toEqual(digest);
    expect(unifiedTaprootKeyPathSighashAll(tx, 0, [{ ...output, script: Buffer.alloc(34) }])).not.toEqual(digest);
    for (const field of ['version', 'locktime', 'sequence', 'output']) {
      const modified = tx.clone();
      if (field === 'version') modified.version++;
      if (field === 'locktime') modified.locktime++;
      if (field === 'sequence') modified.ins[0].sequence++;
      if (field === 'output') modified.outs[0].value++;
      expect(unifiedTaprootKeyPathSighashAll(modified, 0, [output])).not.toEqual(digest);
    }
  });
});
