import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtTaprootTransaction } from '../../class/xbt-taproot-transaction';
import { signUnifiedTaprootInput, finalizeUnifiedTaprootInput, assertUnifiedTaprootSignatures } from '../../class/xbt/unified-taproot-psbt';
import { buildUnsignedTransaction } from '../../class/xbt/unified-psbt';
import nodeProof from '../fixtures/xbt-taproot-cold-fees-knots.json';
import startImport from '../../class/wallet-import';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
  getTransactionsByAddress: jest.fn().mockResolvedValue([]),
}));
const ECPair = ECPairFactory(ecc);
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const verify = (key: Uint8Array, digest: Uint8Array, sig: Uint8Array) => ecc.verifySchnorr!(digest, key, sig);

function fixture() {
  const cold = new XbtTaprootWallet();
  cold.setSecret(mnemonic);
  const watch = new WatchOnlyWallet();
  watch.setSecret(`tr([00000001/86h/0h/0h]${cold.getXpub()}/0/*)`);
  watch.init();
  watch.setUseWithHardwareWalletEnabled(true);
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, 1), 0);
  const address = cold._getExternalAddressByIndex(0);
  parent.addOutput(bitcoin.address.toOutputScript(address), 100_000n);
  const history: any[] = [{ txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 }];
  jest.spyOn(cold, 'getTransactions').mockImplementation(() => history);
  jest.spyOn(watch._hdWalletInstance!, 'getTransactions').mockImplementation(() => history);
  const utxos = [{ txid: parent.getId(), vout: 0, address, value: 100_000, confirmations: 100 }];
  const change = cold._getInternalAddressByIndex(0);
  const targets = [{ address: cold._getExternalAddressByIndex(1), value: 50_000 }];
  const request = watch.createTransaction(utxos, targets, 1, change).psbt;
  const sign = (psbt: bitcoin.Psbt, finalize = false, bitcoinSignature = false) => {
    const result = bitcoin.Psbt.fromBase64(psbt.toBase64());
    result.data.inputs.forEach((input, index) => {
      const inputAddress = bitcoin.address.fromOutputScript(input.witnessUtxo!.script);
      const key = ECPair.fromWIF(cold._getWifForAddress(inputAddress)!).tweak(bitcoin.crypto.taggedHash('TapTweak', input.tapInternalKey!));
      if (bitcoinSignature) {
        const tx = buildUnsignedTransaction(result);
        const spent = result.data.inputs.map(item => item.witnessUtxo!);
        const digest = tx.hashForWitnessV1(
          index,
          spent.map(out => out.script),
          spent.map(out => out.value),
          1,
        );
        result.data.updateInput(index, { tapKeySig: Buffer.concat([key.signSchnorr!(digest), Buffer.from([0x21])]) });
      } else {
        signUnifiedTaprootInput(result, index, { publicKey: key.publicKey.subarray(1), sign: digest => key.signSchnorr!(digest) });
      }
      if (finalize) finalizeUnifiedTaprootInput(result, index, verify);
    });
    return result;
  };
  const original = cold.createTransaction(utxos, targets, 1, change).tx!;
  history.push({ txid: original.getId(), rawHex: original.toHex(), confirmations: 0, value: -50_000 });
  const mockRemote = () => {
    (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (ids: string[], verbose: boolean) =>
      Object.fromEntries(
        ids.map(id => [
          id,
          verbose
            ? { txid: id, confirmations: history.find(tx => tx.txid === id)?.confirmations ?? 100 }
            : history.find(tx => tx.txid === id)?.rawHex,
        ]),
      ),
    );
  };
  mockRemote();
  return { cold, watch, parent, history, utxos, change, targets, request, original, sign, mockRemote };
}

describe('Taproot cold signing', () => {
  it.each([false, true])('round trips and verifies external Schnorr PSBT signatures (finalized=%s)', finalized => {
    const { watch, request, sign } = fixture();
    const before = request.toBase64();
    const transaction = watch.combinePsbt(before, sign(request, finalized).toBase64());
    expect(transaction.ins[0].witness[0]).toHaveLength(65);
    expect(transaction.ins[0].witness[0][64]).toBe(0x21);
    expect(request.toBase64()).toBe(before);
    expect(request.data.inputs[0].nonWitnessUtxo).toBeDefined();
    expect(Buffer.from(request.data.inputs[0].tapBip32Derivation![0].masterFingerprint).toString('hex')).toBe('00000001');
    expect(request.data.outputs[1].tapBip32Derivation![0].path).toBe("m/86'/0'/0'/1/0");
    expect(watch.getSecret()).toMatch(/^xpub/);
    expect(watch._hdWalletInstance!.getSecret()).toBe('');
  });
  it('rejects a Bitcoin signature relabeled Unified', () => {
    const { watch, request, sign } = fixture();
    expect(() => watch.combinePsbt(request, sign(request, false, true))).toThrow('signature is invalid');
  });
  it.each(['default', 'annex', 'script', 'invalid'])('rejects a returned %s witness', mutation => {
    const { watch, request, sign } = fixture();
    const signed = sign(request, true);
    const tx = signed.extractTransaction();
    if (mutation === 'default') tx.ins[0].witness[0] = tx.ins[0].witness[0].subarray(0, 64);
    if (mutation === 'annex') tx.ins[0].witness.push(Buffer.from([0x50]));
    if (mutation === 'script') tx.ins[0].witness.push(Buffer.from([0x51]), Buffer.alloc(33));
    if (mutation === 'invalid') tx.ins[0].witness[0][0] = (tx.ins[0].witness[0][0] + 1) % 256;
    const witness = tx.ins[0].witness;
    signed.data.inputs[0].finalScriptWitness = Buffer.concat([
      Buffer.from([witness.length]),
      ...witness.flatMap(item => [Buffer.from([item.length]), Buffer.from(item)]),
    ]);
    expect(() => watch.combinePsbt(request, signed)).toThrow();
  });
  it('rejects script-tree metadata and changed recipients', () => {
    const { watch, request, sign } = fixture();
    const scripted = sign(request);
    scripted.data.inputs[0].tapMerkleRoot = Buffer.alloc(32);
    expect(() => watch.combinePsbt(request, scripted)).toThrow('Only BIP86');
    const altered = new bitcoin.Psbt();
    altered.setVersion(request.version);
    altered.addInput({ ...request.txInputs[0], ...request.data.inputs[0] });
    request.txOutputs.forEach((output, index) =>
      altered.addOutput({ script: output.script, value: output.value - BigInt(index === 0 ? 1 : 0) }),
    );
    expect(() => watch.combinePsbt(request, sign(altered))).toThrow();
  });
  it('allows only the verified current request to broadcast, and loses authorization across reload', async () => {
    const { watch, request, sign, utxos, targets, change } = fixture();
    const broadcast = jest.spyOn(watch._hdWalletInstance!, 'broadcastTx').mockResolvedValue(true);
    const transaction = watch.combinePsbt(request, sign(request));
    await expect(watch.broadcastTx(transaction.toHex())).resolves.toBe(true);
    watch.createTransaction(utxos, targets, 2, change);
    await expect(watch.broadcastTx(transaction.toHex())).rejects.toThrow('verified signing request');
    expect(broadcast).toHaveBeenCalledTimes(1);
    watch.prepareForSerialization();
    const recovered = WatchOnlyWallet.fromJson(JSON.stringify(watch)) as unknown as WatchOnlyWallet;
    recovered.init();
    expect(recovered._hdWalletInstance).toBeInstanceOf(XbtTaprootWallet);
    expect(recovered.allowSend()).toBe(true);
    await expect(recovered.broadcastTx(transaction.toHex())).rejects.toThrow('verified signing request');
  });
  it('imports BIP86 read-only, rejects an ambiguous xpub and script-tree descriptor', async () => {
    const { cold } = fixture();
    const run = (secret: string) =>
      startImport(
        secret,
        false,
        false,
        true,
        () => {},
        () => {},
        async () => '',
        true,
      ).promise;
    const result = await run(`tr([00000001/86h/0h/0h]${cold.getXpub()}/0/*)`);
    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0].allowSend()).toBe(false);
    expect((result.wallets[0] as WatchOnlyWallet)._hdWalletInstance).toBeInstanceOf(XbtTaprootWallet);
    await expect(run(cold.getXpub())).rejects.toThrow('BIP84');
    await expect(run(`tr([00000001/86h/0h/0h]${cold.getXpub()}/0/*,{pk(abc)})`)).rejects.toThrow('single-key');
  });
});

describe('Taproot fee bumping', () => {
  it('verifies the public cold signatures accepted by isolated Knots and the mined replacement', () => {
    const parent = bitcoin.Transaction.fromHex(nodeProof.fixture.fundingTransactions[0].rawTx);
    const original = bitcoin.Transaction.fromHex(nodeProof.signed.original.hex);
    const prevouts = original.ins.map(input => parent.outs[input.index]);
    assertUnifiedTaprootSignatures(original, prevouts, verify);
    const replacement = bitcoin.Transaction.fromHex(nodeProof.highReplacement.hex);
    assertUnifiedTaprootSignatures(replacement, prevouts, verify);
    expect(replacement.outs[0]).toEqual(original.outs[0]);
    const child = bitcoin.Transaction.fromHex(nodeProof.signed.cpfp.hex);
    assertUnifiedTaprootSignatures(
      child,
      child.ins.map(input => original.outs[input.index]),
      verify,
    );
    expect(nodeProof.originalAcceptance.allowed).toBe(true);
    expect(nodeProof.replacementAcceptance.allowed).toBe(true);
    expect(nodeProof.cpfpAcceptance.allowed).toBe(true);
    expect(nodeProof.highReplacementAcceptance.allowed).toBe(true);
    expect(nodeProof.negativeAcceptance.allowed).toBe(false);
    expect(nodeProof.replacementWithChild.allowed).toBe(false);
    expect(nodeProof.postReplacementMempool).toEqual([replacement.getId()]);
    expect(nodeProof.minedReplacement.txid).toBe(replacement.getId());
    expect(nodeProof.minedReplacement.confirmations).toBe(1);
    expect(nodeProof.networkactive).toBe(false);
    expect(nodeProof.connections).toBe(0);
  });

  it('preserves all inputs, sequences, own receive payments and recipient outputs while reducing only change', async () => {
    const { cold, original, utxos } = fixture();
    const controller = new XbtTaprootTransaction(null, original.getId(), cold);
    expect(await controller.canBumpTx()).toBe(true);
    const result = await controller.createRBFbumpFee(3);
    expect(result.tx!.ins.map(input => [Buffer.from(input.hash).toString('hex'), input.index, input.sequence])).toEqual(
      original.ins.map(input => [Buffer.from(input.hash).toString('hex'), input.index, input.sequence]),
    );
    expect(result.tx!.outs[0]).toEqual(original.outs[0]);
    expect(result.tx!.outs[1].value).toBeLessThan(original.outs[1].value);
    expect(result.fee).toBe(Math.ceil(result.tx!.virtualSize() * 3));
    expect(() => cold.createRBFTransaction(original, utxos, 1)).toThrow('original fee');
    expect(() => cold.createRBFTransaction(original, utxos, 1000)).toThrow('recipient amounts');
  });
  it('routes a cold replacement through the reviewed request and verifies its external signature', async () => {
    const { watch, original, sign } = fixture();
    const controller = new XbtTaprootTransaction(null, original.getId(), watch as any);
    const result = await controller.createRBFbumpFee(3);
    expect(result.tx).toBeUndefined();
    const transaction = watch.combinePsbt(result.psbt, sign(result.psbt));
    expect(transaction.outs[0]).toEqual(original.outs[0]);
    expect(result.fee / transaction.virtualSize()).toBe(3);
  });
  it('rejects send-all without change, confirmed transactions and non-RBF sequence', async () => {
    const { cold, utxos, targets, change, history } = fixture();
    for (const sequence of [0xfffffffe, 0xffffffff]) {
      const transaction = cold.createTransaction(utxos, targets, 1, change, sequence).tx!;
      history.push({ txid: transaction.getId(), rawHex: transaction.toHex(), confirmations: 0 });
      const controller = new XbtTaprootTransaction(null, transaction.getId(), cold);
      expect(await controller.isSequenceReplaceable()).toBe(false);
      await expect(controller.createRBFbumpFee(3)).rejects.toThrow();
    }
    const max = cold.createTransaction(utxos, [{ address: targets[0].address }], 1, change).tx!;
    history.push({ txid: max.getId(), rawHex: max.toHex(), confirmations: 0 });
    const controller = new XbtTaprootTransaction(null, max.getId(), cold);
    expect(await controller.canBumpTx()).toBe(false);
    history.find(tx => tx.txid === max.getId()).confirmations = 1;
    await expect(controller.createRBFbumpFee(3)).rejects.toThrow('unconfirmed');
  });
  it.each([false, true])('prices CPFP to the whole two-transaction package (cold=%s)', async external => {
    const { cold, watch, original, history, sign } = fixture();
    const wallet = external ? watch : cold;
    const hd = external ? watch._hdWalletInstance! : cold;
    hd._utxo = original.outs.map((output, vout) => ({
      txid: original.getId(),
      vout,
      value: Number(output.value),
      address: bitcoin.address.fromOutputScript(output.script),
      height: 0,
      confirmations: 0,
    }));
    jest.spyOn(wallet, 'fetchUtxo').mockResolvedValue();
    const controller = new XbtTaprootTransaction(null, original.getId(), wallet as any);
    const info = await controller.getInfo();
    const result = await controller.createCPFPbumpFee(10);
    const child = external ? watch.combinePsbt(result.psbt, sign(result.psbt)) : result.tx!;
    expect((info.fee + result.fee) / (original.virtualSize() + child.virtualSize())).toBeGreaterThanOrEqual(10);
    expect(child.outs).toHaveLength(1);
    expect(wallet.addressIsChange(bitcoin.address.fromOutputScript(child.outs[0].script))).toBe(true);
    history[0].confirmations = 0;
    await expect(controller.createCPFPbumpFee(10)).rejects.toThrow('confirmed inputs');
  });
});
