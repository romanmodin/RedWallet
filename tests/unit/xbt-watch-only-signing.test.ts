import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { signUnifiedP2wpkhInput, finalizeUnifiedP2wpkhInput } from '../../class/xbt/unified-psbt';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ECPair = ECPairFactory(ecc);
function fixture() {
  const cold = new XbtSegwitBech32Wallet();
  cold.setSecret(mnemonic);
  const watch = new WatchOnlyWallet();
  watch.setSecret(cold.getXpub());
  watch.init();
  watch.setUseWithHardwareWalletEnabled(true);
  const address = watch._getExternalAddressByIndex(0);
  const funding = new bitcoin.Transaction();
  funding.addInput(Buffer.alloc(32, 1), 0);
  funding.addOutput(bitcoin.address.toOutputScript(address), 100_000n);
  jest
    .spyOn(watch._hdWalletInstance!, 'getTransactions')
    .mockReturnValue([{ txid: funding.getId(), rawHex: funding.toHex(), confirmations: 100 }] as any);
  const utxos = [
    {
      txid: funding.getId(),
      vout: 0,
      address,
      value: 100_000,
      confirmations: 100,
    },
  ];
  const targets = [{ address: cold._getExternalAddressByIndex(1), value: 50_000 }];
  const change = watch._getInternalAddressByIndex(0);
  const request = watch.createTransaction(utxos, targets, 1, change).psbt;
  const key = ECPair.fromWIF(cold._getWifForAddress(address)!);
  const signed = request.clone();
  signUnifiedP2wpkhInput(signed, 0, key);
  return { watch, request, signed, key, utxos, targets, change };
}

describe('XBT external signing', () => {
  it('requires explicit enrollment; legacy hardware flags do not enable spending', () => {
    const { watch } = fixture();
    watch.xbt_signer_enabled = false;
    watch.use_with_hardware_wallet = true;
    expect(watch.allowSend()).toBe(false);
    expect(() => watch.createTransaction([], [], 1, '')).toThrow('Enable');
    expect(watch.getSecret()).toMatch(/^zpub/);
  });
  it.each([false, true])('accepts valid Unified signatures (already finalized: %s) without mutating the review', finalized => {
    const { watch, request, signed, key } = fixture();
    const before = request.toBase64();
    if (finalized)
      finalizeUnifiedP2wpkhInput(signed, 0, key.publicKey, (pubkey, digest, signature) => ecc.verify(digest, pubkey, signature));
    const tx = watch.combinePsbt(request.toBase64(), signed.toBase64());
    expect(tx.ins[0].witness[0].at(-1)).toBe(0x21);
    expect(request.toBase64()).toBe(before);
    expect(request.data.inputs[0].sighashType).toBe(0x21);
  });
  it('rejects a BTC signature even if its trailing byte is relabeled 0x21', () => {
    const { watch, request, key } = fixture();
    const signed = request.clone();
    delete signed.data.inputs[0].sighashType;
    signed.signInput(0, key);
    const signature = signed.data.inputs[0].partialSig![0].signature;
    signature[signature.length - 1] = 0x21;
    expect(() => watch.combinePsbt(request, signed)).toThrow('validation failed');
  });
  it('rejects an ordinary BTC signature and an undeclared signing request', () => {
    const { watch, request, key } = fixture();
    const signed = request.clone();
    delete signed.data.inputs[0].sighashType;
    signed.signInput(0, key);
    expect(() => watch.combinePsbt(request, signed)).toThrow();
    expect(() => watch.combinePsbt(signed, signed)).toThrow('does not declare');
  });
  it('rejects changed outputs from the external signer', () => {
    const { watch, request } = fixture();
    const altered = new bitcoin.Psbt();
    altered.setVersion(request.version);
    altered.addInput({ ...request.txInputs[0], ...request.data.inputs[0] });
    altered.addOutput({ script: request.txOutputs[0].script, value: 49_000n });
    expect(() => watch.combinePsbt(request, altered)).toThrow();
  });
  it('only broadcasts the locally verified result of the current request', async () => {
    const { watch, request, signed, utxos, targets, change } = fixture();
    const broadcast = jest.spyOn(watch._hdWalletInstance!, 'broadcastTx').mockResolvedValue(true);
    const tx = watch.combinePsbt(request, signed);
    await expect(watch.broadcastTx('00')).rejects.toThrow('verified signing request');
    expect(broadcast).not.toHaveBeenCalled();
    await expect(watch.broadcastTx(tx.toHex())).resolves.toBe(true);
    watch.createTransaction(utxos, targets, 1, change);
    await expect(watch.broadcastTx(tx.toHex())).rejects.toThrow('verified signing request');
  });
  it('preserves public keys and explicit XBT mode across serialization', () => {
    const { watch } = fixture();
    watch.prepareForSerialization();
    const restored = WatchOnlyWallet.fromJson(JSON.stringify(watch)) as unknown as WatchOnlyWallet;
    restored.init();
    expect(restored.allowSend()).toBe(true);
    expect(restored._hdWalletInstance).toBeInstanceOf(XbtSegwitBech32Wallet);
    expect(restored._hdWalletInstance!.getSecret()).not.toBe(mnemonic);
  });
});
