import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { XbtTaprootWallet } from '../wallets/xbt-taproot-wallet';
import { WatchOnlyWallet } from '../wallets/watch-only-wallet';
import { Transaction as WalletTransaction } from '../wallets/types';
import { buildUnsignedTransaction } from './unified-psbt';
import { assertSignedUnifiedTaprootTransactionMatchesPsbt } from './unified-taproot-psbt';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('XBT Taproot self-test: ' + message);
}

/** Offline public vector only. Never reads storage, connects to a node, or broadcasts. */
export function runTaprootSigningSelfTest(): void {
  const cold = new XbtTaprootWallet();
  cold.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const watch = new WatchOnlyWallet();
  watch.setSecret(`tr([00000001/86h/0h/0h]${cold.getXpub()}/0/*)`);
  watch.init();
  watch.setUseWithHardwareWalletEnabled(true);
  check(watch._hdWalletInstance instanceof XbtTaprootWallet, 'wrong watch-only wallet');
  const address = cold._getExternalAddressByIndex(0);
  const change = cold._getInternalAddressByIndex(0);
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, 1), 0);
  parent.addOutput(bitcoin.address.toOutputScript(address), 100_000n);
  const history = [{ txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 }] as WalletTransaction[];
  cold.getTransactions = () => history;
  watch._hdWalletInstance!.getTransactions = () => history;
  const inputs = [{ txid: parent.getId(), vout: 0, value: 100_000, address, confirmations: 100 }];
  const targets = [{ address: cold._getExternalAddressByIndex(1), value: 50_000 }];
  const verifier = (key: Uint8Array, digest: Uint8Array, signature: Uint8Array) => ecc.verifySchnorr!(digest, key, signature);
  for (const finalized of [false, true]) {
    const request = watch.createTransaction(inputs, targets, 1, change).psbt;
    check(
      Buffer.from(request.data.inputs[0].tapBip32Derivation![0].masterFingerprint).toString('hex') === '00000001',
      'fingerprint byte order',
    );
    check(!!request.data.inputs[0].nonWitnessUtxo, 'missing raw parent');
    const signed = cold.createTransaction(inputs, targets, 1, change);
    const returned = finalized ? signed.psbt : request.clone();
    if (!finalized) returned.data.updateInput(0, { tapKeySig: signed.tx!.ins[0].witness[0] });
    const transaction = watch.combinePsbt(request.toBase64(), returned.toBase64());
    check(transaction.toHex() === signed.tx!.toHex(), 'cold PSBT round trip changed the transaction');
    check(transaction.ins[0].witness[0].length === 65 && transaction.ins[0].witness[0][64] === 0x21, 'wrong Unified signature');
    const changed = transaction.clone();
    changed.outs[0].value -= 1n;
    let rejected = false;
    try {
      assertSignedUnifiedTaprootTransactionMatchesPsbt(changed.toHex(), request, verifier);
    } catch {
      rejected = true;
    }
    check(rejected, 'changed recipient was accepted');
    const invalid = finalized ? signed.psbt.clone() : request.clone();
    if (finalized) {
      const witness = Buffer.from(invalid.data.inputs[0].finalScriptWitness!);
      witness[witness.length - 1] = 1;
      invalid.data.inputs[0].finalScriptWitness = witness;
    } else {
      const signature = Buffer.from(transaction.ins[0].witness[0]);
      signature[64] = 1;
      invalid.data.updateInput(0, { tapKeySig: signature });
    }
    rejected = false;
    try {
      watch.combinePsbt(request, invalid);
    } catch {
      rejected = true;
    }
    check(rejected, 'Bitcoin signature flag was accepted');
  }
  const original = cold.createTransaction(inputs, targets, 1, change);
  history.push({ txid: original.tx!.getId(), rawHex: original.tx!.toHex(), confirmations: 0 } as WalletTransaction);
  const replacementRequest = watch.createRBFTransaction(original.tx!, inputs, 3);
  const replacement = cold.createRBFTransaction(original.tx!, inputs, 3);
  const replacementTx = watch.combinePsbt(replacementRequest.psbt.toBase64(), replacement.psbt.toBase64());
  check(replacementTx.outs[0].value === original.tx!.outs[0].value, 'RBF changed recipient amount');
  check(Buffer.from(replacementTx.outs[0].script).equals(Buffer.from(original.tx!.outs[0].script)), 'RBF changed recipient script');
  check(replacement.fee === replacementTx.virtualSize() * 3, 'RBF fee pricing');
  const childInputs = [
    { txid: original.tx!.getId(), vout: 1, address: change, value: Number(original.tx!.outs[1].value), confirmations: 0 },
  ];
  cold.next_free_change_address_index = 1;
  watch._hdWalletInstance!.next_free_change_address_index = 1;
  const childAddress = cold._getInternalAddressByIndex(1);
  const estimate = cold.createTransaction(childInputs, [{ address: childAddress }], 1, childAddress, undefined, true);
  const priced = buildUnsignedTransaction(estimate.psbt);
  priced.setWitness(0, [Buffer.alloc(65)]);
  const packageFee = Math.ceil((original.tx!.virtualSize() + priced.virtualSize()) * 10);
  const rate = Math.max(1, (packageFee - original.fee) / priced.virtualSize());
  const childRequest = watch.createTransaction(childInputs, [{ address: childAddress }], rate, childAddress);
  const child = cold.createTransaction(childInputs, [{ address: childAddress }], rate, childAddress);
  const childTx = watch.combinePsbt(childRequest.psbt.toBase64(), child.psbt.toBase64());
  check((original.fee + child.fee) / (original.tx!.virtualSize() + childTx.virtualSize()) >= 10, 'CPFP package pricing');
  check(childTx.outs.length === 1 && cold.addressIsChange(bitcoin.address.fromOutputScript(childTx.outs[0].script)), 'CPFP foreign output');
  check(watch._hdWalletInstance!.getSecret() === '', 'watch-only contains private seed');
}
