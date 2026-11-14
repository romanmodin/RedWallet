import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { signUnifiedP2wpkhInput, finalizeUnifiedP2wpkhInput } from '../../class/xbt/unified-psbt';
import { verifyStandardHardwareFunding, assertStandardHardwareResult } from '../../class/xbt/standard-hardware';
jest.mock('../../class/xbt/standard-hardware', () => ({
  ...jest.requireActual('../../class/xbt/standard-hardware'),
  assertStandardHardwareReleased: jest.fn(),
}));

const ECPair = ECPairFactory(ecc);
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function fixture() {
  const cold = new XbtSegwitBech32Wallet();
  cold.setSecret(mnemonic);
  const watch = new WatchOnlyWallet();
  watch.setSecret('[445a39f0/84h/0h/0h]' + cold.getXpub());
  watch.init();
  watch.setUseWithHardwareWalletEnabled(true);
  const receive = watch._getExternalAddressByIndex(0);
  const key = ECPair.fromWIF(cold._getWifForAddress(receive)!);
  const ancestor = new bitcoin.Transaction();
  ancestor.addInput(Buffer.alloc(32, 1), 0);
  ancestor.addOutput(bitcoin.address.toOutputScript(receive), 200000n);
  const funding = new bitcoin.Psbt();
  funding.addInput({ hash: ancestor.getId(), index: 0, witnessUtxo: ancestor.outs[0], sighashType: 0x21 });
  funding.addOutput({ address: receive, value: 199000n });
  signUnifiedP2wpkhInput(funding, 0, key);
  finalizeUnifiedP2wpkhInput(funding, 0, key.publicKey, (pubkey, hash, sig) => ecc.verify(hash, pubkey, sig));
  const parent = funding.extractTransaction();
  const raws: Record<string, string> = { [parent.getId()]: parent.toHex(), [ancestor.getId()]: ancestor.toHex() };
  const coins = [{ txid: parent.getId(), vout: 0, value: 199000, address: receive, confirmations: 10 }];
  const histories = { [receive]: [{ tx_hash: parent.getId(), height: 1000000 }] };
  const source = {
    raw: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, raws[id]])),
    history: async () => histories,
    tip: async () => 1000009,
  };
  jest
    .spyOn(watch._hdWalletInstance!, 'getTransactions')
    .mockReturnValue([{ txid: parent.getId(), rawHex: parent.toHex(), confirmations: 10 }] as any);
  const targets = [{ address: cold._getExternalAddressByIndex(1), value: 50000 }];
  const change = watch._getInternalAddressByIndex(0);
  return { cold, watch, receive, key, ancestor, parent, raws, coins, histories, source, targets, change };
}
afterEach(() => jest.restoreAllMocks());

it('verifies cryptographic Unified funding rather than a flag alone', async () => {
  const f = fixture();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).resolves.toHaveProperty('parents');
  const bad = f.parent.clone();
  bad.ins[0].witness[0][8] = (bad.ins[0].witness[0][8] + 1) % 256;
  f.raws[bad.getId()] = bad.toHex();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow();
});
it.each([0, 961639, 1000005, 1000011])('blocks unconfirmed, pre-fork, immature or future funding at %s', async height => {
  const f = fixture();
  f.histories[f.receive][0].height = height;
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('Protection unverified');
});
it('blocks missing ancestors, false input values and missing current tip', async () => {
  const f = fixture();
  await expect(verifyStandardHardwareFunding([{ ...f.coins[0], value: 1 }], f.source)).rejects.toThrow('mismatch');
  await expect(verifyStandardHardwareFunding(f.coins, { ...f.source, tip: async () => null })).rejects.toThrow('tip');
  delete f.raws[f.ancestor.getId()];
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('missing');
});
it('blocks ordinary funding and relabeled ordinary signatures', async () => {
  const f = fixture();
  const standard = new bitcoin.Psbt();
  standard.addInput({ hash: f.ancestor.getId(), index: 0, witnessUtxo: f.ancestor.outs[0], sighashType: 1 });
  standard.addOutput({ address: f.receive, value: 199000n });
  standard.signInput(0, f.key);
  standard.finalizeAllInputs();
  const tx = standard.extractTransaction();
  f.raws[tx.getId()] = tx.toHex();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow();
  tx.ins[0].witness[0][tx.ins[0].witness[0].length - 1] = 0x21;
  f.raws[tx.getId()] = tx.toHex();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow();
});
async function ready() {
  const f = fixture();
  f.watch.setHardwareSigningMode('standard');
  jest.spyOn(BlueElectrum, 'multiGetTransactionByTxid').mockImplementation(f.source.raw as any);
  jest.spyOn(BlueElectrum, 'multiGetHistoryByAddress').mockImplementation(f.source.history as any);
  jest.spyOn(BlueElectrum, 'getReportedBlockTip').mockImplementation(f.source.tip);
  await f.watch.prepareStandardHardwareSigning(f.coins);
  const request = f.watch.createTransaction(f.coins, f.targets, 1, f.change).psbt;
  const signed = request.clone();
  signed.signInput(0, f.key);
  return { ...f, request, signed };
}
it.each([false, true])('accepts standard signatures only for a reviewed proof-gated request (finalized %s)', async finalized => {
  const f = await ready();
  expect(f.request.data.inputs[0].sighashType).toBe(1);
  expect(f.request.data.inputs[0].nonWitnessUtxo).toBeDefined();
  expect(Buffer.from(f.request.data.inputs[0].bip32Derivation![0].masterFingerprint).toString('hex')).toBe('445a39f0');
  if (finalized) f.signed.finalizeAllInputs();
  const tx = f.watch.combinePsbt(f.request, f.signed);
  expect(tx.ins[0].witness[0].at(-1)).toBe(1);
  expect(() => assertStandardHardwareResult(tx.toHex(), f.request)).not.toThrow();
  const changed = tx.clone();
  changed.outs[0].value -= 1n;
  expect(() => assertStandardHardwareResult(changed.toHex(), f.request)).toThrow('changed');
});
it('retains Unified default and refuses unverified standard requests', () => {
  const f = fixture();
  expect(f.watch.getHardwareSigningMode()).toBe('unified');
  expect(f.watch.createTransaction(f.coins, f.targets, 1, f.change).psbt.data.inputs[0].sighashType).toBe(0x21);
  f.watch.setHardwareSigningMode('standard');
  expect(() => f.watch.createTransaction(f.coins, f.targets, 1, f.change)).toThrow('Protection unverified');
});
it('expires proof and invalidates pending signatures on a mode change', async () => {
  const f = await ready();
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 300001);
  expect(() => f.watch.combinePsbt(f.request, f.signed)).toThrow('Protection unverified');
  jest.restoreAllMocks();
  f.watch.setHardwareSigningMode('unified');
  f.watch.setHardwareSigningMode('standard');
  expect(() => f.watch.combinePsbt(f.request, f.signed)).toThrow('current reviewed');
});
it('does not persist proof permission across wallet reload', async () => {
  const f = await ready();
  f.watch.prepareForSerialization();
  const restored = WatchOnlyWallet.fromJson(JSON.stringify(f.watch)) as unknown as WatchOnlyWallet;
  restored.init();
  expect(restored.getHardwareSigningMode()).toBe('standard');
  expect(() => restored.combinePsbt(f.request, f.signed)).toThrow('current reviewed');
});
it('refuses a changed transaction at the broadcast boundary', async () => {
  const f = await ready();
  const tx = f.watch.combinePsbt(f.request, f.signed);
  const broadcast = jest.spyOn(BlueElectrum, 'broadcastStandardHardware').mockResolvedValue(tx.getId());
  await expect(f.watch.broadcastTx('00')).rejects.toThrow('verified signing request');
  expect(broadcast).not.toHaveBeenCalled();
  await expect(f.watch.broadcastTx(tx.toHex())).resolves.toBe(true);
  await expect(f.watch.broadcastTx(tx.toHex())).rejects.toThrow('verified signing request');
});
it('transport rejects a reorg or unavailable history before submitting', async () => {
  const f = await ready();
  const tx = f.watch.combinePsbt(f.request, f.signed);
  f.histories[f.receive][0].height = 0;
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('six XBT confirmations');
  await expect(BlueElectrum.broadcastStandardHardware(tx.toHex(), f.request, () => {})).rejects.toThrow('Electrum client is not connected');
});

it('rejects a valid signature with a changed sighash and clears broadcast authorization', async () => {
  const f = await ready();
  const tx = f.watch.combinePsbt(f.request, f.signed);
  const wrong = f.signed.clone();
  wrong.data.inputs[0].partialSig![0].signature[wrong.data.inputs[0].partialSig![0].signature.length - 1] = 0x81;
  expect(() => f.watch.combinePsbt(f.request, wrong)).toThrow();
  await expect(f.watch.broadcastTx(tx.toHex())).rejects.toThrow('verified signing request');
});
it('ignores late proof results after the wallet or signing mode changes', async () => {
  const f = fixture();
  f.watch.setHardwareSigningMode('standard');
  let resume!: () => void;
  jest.spyOn(BlueElectrum, 'multiGetTransactionByTxid').mockImplementation(async (ids: any) => {
    await new Promise<void>(resolve => {
      resume = resolve;
    });
    return f.source.raw(ids) as any;
  });
  jest.spyOn(BlueElectrum, 'multiGetHistoryByAddress').mockImplementation(f.source.history as any);
  jest.spyOn(BlueElectrum, 'getReportedBlockTip').mockImplementation(f.source.tip);
  const pending = f.watch.prepareStandardHardwareSigning(f.coins);
  f.watch.setHardwareSigningMode('unified');
  resume();
  await new Promise(resolve => setTimeout(resolve, 0));
  resume();
  await expect(pending).rejects.toThrow('Signing mode changed');
});

it('keeps production standard signing disabled pending stronger separation proof', () => {
  const production = jest.requireActual('../../class/xbt/standard-hardware');
  expect(production.STANDARD_HARDWARE_RELEASE_ENABLED).toBe(false);
  expect(() => production.assertStandardHardwareReleased()).toThrow('coin separation');
});

it('cannot treat a Unified witness as proof of a chain-exclusive txid', () => {
  const f = fixture();
  const standard = new bitcoin.Psbt();
  standard.addInput({ hash: f.ancestor.getId(), index: 0, witnessUtxo: f.ancestor.outs[0], sighashType: 1 });
  standard.addOutput({ address: f.receive, value: 199000n });
  standard.signInput(0, f.key);
  standard.finalizeAllInputs();
  const tx = standard.extractTransaction();
  expect(tx.getId()).toBe(f.parent.getId());
  expect(tx.toHex()).not.toBe(f.parent.toHex());
});
