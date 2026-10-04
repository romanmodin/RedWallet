/** Public-fixture signing bridge only; node RPC/broadcast stays with the isolated regtest controller. */
import * as fs from 'fs';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtTaprootTransaction } from '../../class/xbt-taproot-transaction';
import { signUnifiedTaprootInput } from '../../class/xbt/unified-taproot-psbt';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
  getTransactionsByAddress: jest.fn().mockResolvedValue([]),
}));
const testBridge = process.env.XBT_KNOTS_FIXTURE ? it : it.skip;

testBridge('exports cold signed original, replacement and CPFP transactions for isolated Knots acceptance', async () => {
  const resultPath = process.env.XBT_KNOTS_RESULT;
  if (!resultPath?.startsWith('/') || resultPath === process.env.XBT_KNOTS_FIXTURE)
    throw new Error('An explicit separate output is required');
  const fixture = JSON.parse(fs.readFileSync(process.env.XBT_KNOTS_FIXTURE!, 'utf8'));
  expect(fixture.chain).toBe('regtest');
  expect(fixture.height).toBeGreaterThanOrEqual(fixture.blake2bHeight);
  const cold = new XbtTaprootWallet();
  cold.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const watch = new WatchOnlyWallet();
  watch.setSecret(`tr([73c5da0a/86h/0h/0h]${cold.getXpub()}/0/*)`);
  watch.init();
  watch.setUseWithHardwareWalletEnabled(true);
  const history: any[] = fixture.fundingTransactions.map((funding: any) => {
    const transaction = bitcoin.Transaction.fromHex(funding.rawTx);
    expect(transaction.isCoinbase()).toBe(false);
    expect(funding.confirmations).toBeGreaterThan(0);
    return { txid: transaction.getId(), rawHex: funding.rawTx, confirmations: funding.confirmations };
  });
  jest.spyOn(watch._hdWalletInstance!, 'getTransactions').mockImplementation(() => history);
  const utxos = [60_000, 40_000].map((value, index) => {
    const address = cold._getExternalAddressByIndex(index);
    const script = Buffer.from(bitcoin.address.toOutputScript(address));
    const matches = history.flatMap(parent =>
      bitcoin.Transaction.fromHex(parent.rawHex).outs.flatMap((output, vout) =>
        output.value === BigInt(value) && script.equals(Buffer.from(output.script))
          ? [{ txid: parent.txid, vout, value, address, confirmations: parent.confirmations }]
          : [],
      ),
    );
    expect(matches).toHaveLength(1);
    return matches[0];
  });
  const ECPair = ECPairFactory(ecc);
  const externalSign = (request: bitcoin.Psbt) => {
    const returned = bitcoin.Psbt.fromBase64(request.toBase64());
    returned.data.inputs.forEach((input, index) => {
      expect(input.nonWitnessUtxo).toBeDefined();
      const address = bitcoin.address.fromOutputScript(input.witnessUtxo!.script);
      const key = ECPair.fromWIF(cold._getWifForAddress(address)!).tweak(bitcoin.crypto.taggedHash('TapTweak', input.tapInternalKey!));
      signUnifiedTaprootInput(returned, index, { publicKey: key.publicKey.subarray(1), sign: digest => key.signSchnorr!(digest) });
    });
    return watch.combinePsbt(request.toBase64(), returned.toBase64());
  };
  const originalResult = watch.createTransaction(
    utxos,
    [{ address: cold._getExternalAddressByIndex(2), value: 90_000 }],
    1,
    watch._getInternalAddressByIndex(0),
  );
  const original = externalSign(originalResult.psbt);
  history.push({ txid: original.getId(), rawHex: original.toHex(), confirmations: 0, value: -90_000 });
  (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (ids: string[], verbose: boolean) =>
    Object.fromEntries(
      ids.map(id => [
        id,
        verbose
          ? { txid: id, confirmations: history.find(tx => tx.txid === id)?.confirmations }
          : history.find(tx => tx.txid === id)?.rawHex,
      ]),
    ),
  );
  const controller = new XbtTaprootTransaction(null, original.getId(), watch as any);
  const replacementResult = await controller.createRBFbumpFee(Number(process.env.XBT_KNOTS_RBF_RATE ?? 3));
  const replacement = externalSign(replacementResult.psbt);
  expect(replacement.outs[0]).toEqual(original.outs[0]);
  watch._hdWalletInstance!._utxo = original.outs.map((output, vout) => ({
    txid: original.getId(),
    vout,
    address: bitcoin.address.fromOutputScript(output.script),
    value: Number(output.value),
    confirmations: 0,
    height: 0,
  }));
  jest.spyOn(watch, 'fetchUtxo').mockResolvedValue();
  const childResult = await controller.createCPFPbumpFee(10);
  const child = externalSign(childResult.psbt);
  expect((originalResult.fee + childResult.fee) / (original.virtualSize() + child.virtualSize())).toBeGreaterThanOrEqual(10);
  const mutation = original.clone();
  mutation.outs[0].value -= 1n;
  fs.writeFileSync(
    resultPath,
    JSON.stringify(
      {
        chain: fixture.chain,
        height: fixture.height,
        original: { hex: original.toHex(), txid: original.getId(), fee: originalResult.fee, vsize: original.virtualSize() },
        replacement: { hex: replacement.toHex(), txid: replacement.getId(), fee: replacementResult.fee, vsize: replacement.virtualSize() },
        cpfp: { hex: child.toHex(), txid: child.getId(), fee: childResult.fee, vsize: child.virtualSize() },
        negative: { changedOutput: mutation.toHex() },
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
});
