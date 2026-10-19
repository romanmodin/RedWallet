import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { XbtSegwitBech32Wallet } from '../wallets/xbt-segwit-bech32-wallet';
import { Transaction as WalletTransaction } from '../wallets/types';
import { assertSignedUnifiedTransactionMatchesPsbt } from './unified-psbt';
import { requiresHighFeeApproval } from './fee-policy';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('XBT BIP84 replacement self-test: ' + message);
}

function rejects(action: () => unknown, message: string): void {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  check(rejected, message);
}

/** Offline public fixture only; no storage, RPC, network access or broadcast. */
export function runBip84ReplacementSelfTest(): void {
  const wallet = new XbtSegwitBech32Wallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const source = wallet._getExternalAddressByIndex(0);
  const recipient = wallet._getExternalAddressByIndex(1);
  const change = wallet._getInternalAddressByIndex(0);
  const parent = new bitcoin.Transaction();
  parent.addInput(Buffer.alloc(32, 1), 0);
  parent.addOutput(bitcoin.address.toOutputScript(source), 100000n);
  const history = [{ txid: parent.getId(), rawHex: parent.toHex(), confirmations: 100 }] as WalletTransaction[];
  wallet.getTransactions = () => history;
  const original = wallet.createTransaction(
    [{ txid: parent.getId(), vout: 0, address: source, value: 100000, confirmations: 100 }],
    [{ address: recipient, value: 50000 }],
    1,
    change,
    0xfffffffd,
  ).tx!;
  const known = { txid: original.getId(), rawHex: original.toHex(), confirmations: 0 } as WalletTransaction;
  history.push(known);
  const request = wallet.createAuthenticatedRBFTransaction(original.getId(), 3, true, 1);
  const replacement = wallet.createAuthenticatedRBFTransaction(original.getId(), 3);
  const tx = replacement.tx!;
  assertSignedUnifiedTransactionMatchesPsbt(tx.toHex(), request.psbt, (key, digest, sig) => ecc.verify(digest, key, sig));
  check(tx.outs[0].value === original.outs[0].value, 'recipient value changed');
  check(Buffer.from(tx.outs[0].script).equals(Buffer.from(original.outs[0].script)), 'recipient script changed');
  check(tx.outs[1].value >= 294n && tx.outs[1].value < original.outs[1].value, 'change dust or fee reduction');
  check(tx.version === original.version && tx.locktime === original.locktime, 'version or locktime changed');
  check(tx.ins[0].sequence === original.ins[0].sequence, 'sequence changed');
  check(
    Buffer.from(tx.ins[0].hash).equals(Buffer.from(original.ins[0].hash)) && tx.ins[0].index === original.ins[0].index,
    'input changed',
  );
  check(tx.ins[0].witness[0][tx.ins[0].witness[0].length - 1] === 0x21, 'wrong sighash');
  check(replacement.fee >= wallet.getAuthenticatedRBFInfo(original.getId()).oldFee + tx.virtualSize(), 'insufficient incremental fee');
  const derivation = request.psbt.data.outputs[1].bip32Derivation![0];
  check(Buffer.from(derivation.masterFingerprint).toString('hex') === '01000000', 'fingerprint padding');
  check(
    Buffer.from(bitcoin.payments.p2wpkh({ pubkey: derivation.pubkey }).output!).equals(Buffer.from(tx.outs[1].script)),
    'change derivation',
  );
  for (const rate of [1, -1, Number.NaN, Number.POSITIVE_INFINITY, 100000]) {
    rejects(() => wallet.createAuthenticatedRBFTransaction(original.getId(), rate), 'invalid fee accepted');
  }
  const changed = original.clone();
  changed.outs[0].value -= 1n;
  known.rawHex = changed.toHex();
  rejects(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3), 'changed recipient accepted');
  const badWitness = original.clone();
  badWitness.ins[0].witness[0][10] = (badWitness.ins[0].witness[0][10] + 1) % 256;
  known.rawHex = badWitness.toHex();
  rejects(() => wallet.getAuthenticatedRBFInfo(original.getId()), 'bad witness accepted');
  const bitcoinSignature = original.clone();
  const sig = bitcoinSignature.ins[0].witness[0];
  sig[sig.length - 1] = 1;
  known.rawHex = bitcoinSignature.toHex();
  rejects(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3), 'Bitcoin sighash accepted');
  known.rawHex = original.toHex();
  known.confirmations = 1;
  rejects(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3), 'confirmed original accepted');
  known.confirmations = 0;
  const changedParent = parent.clone();
  changedParent.outs[0].value += 1n;
  history[0].rawHex = changedParent.toHex();
  rejects(() => wallet.createAuthenticatedRBFTransaction(original.getId(), 3), 'forged parent amount accepted');
  check(requiresHighFeeApproval({ feeSats: 20000, feeRate: 200, amountSats: 50000 }), 'high fee review missing');
}
