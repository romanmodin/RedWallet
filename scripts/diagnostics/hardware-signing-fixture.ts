/** Offline signature-format qualification only. No network, keys, wallet state or broadcast. */
import { createHash } from 'crypto';
import BIP32Factory from 'bip32';
import bs58check from 'bs58check';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const MAX_RETURN_BYTES = 64 * 1024;
export const FIXTURE_PURPOSE = 'OFFLINE HARDWARE TEST — INVALID FUNDING — NEVER BROADCAST';
export type PublicAccount = {
  fingerprint: string;
  accountPath: string;
  xpub: string;
};

export function parsePublicAccount(value: unknown): PublicAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A public account JSON object is required');
  const fields = Object.keys(value).sort();
  if (fields.join(',') !== 'accountPath,fingerprint,xpub')
    throw new Error('Only fingerprint, accountPath and xpub are accepted; never provide private material');
  const account = value as PublicAccount;
  if (typeof account.fingerprint !== 'string' || !/^[0-9a-fA-F]{8}$/.test(account.fingerprint))
    throw new Error('An eight-digit master fingerprint is required');
  if (typeof account.accountPath !== 'string') throw new Error('A BIP84 mainnet account path is required');
  const accountPath = account.accountPath.replace(/h/g, "'");
  const match = /^m\/84'\/0'\/(0|[1-9][0-9]{0,9})'$/.exec(accountPath);
  if (!match || Number(match[1]) > 0x7fffffff) throw new Error('Only hardened BIP84 mainnet account paths are supported');
  if (typeof account.xpub !== 'string' || !/^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]{100,120}$/.test(account.xpub))
    throw new Error('Only a mainnet account xpub or zpub is accepted');
  let xpub: string;
  try {
    const payload = Buffer.from(bs58check.decode(account.xpub));
    const version = payload.readUInt32BE(0);
    if (payload.length !== 78 || ![0x0488b21e, 0x04b24746].includes(version)) throw new Error('version');
    payload.writeUInt32BE(0x0488b21e, 0);
    xpub = bs58check.encode(payload);
    const node = bip32.fromBase58(xpub);
    if (!node.isNeutered() || node.depth !== 3 || node.index !== Number(match[1]) + 0x80000000) throw new Error('origin');
  } catch {
    throw new Error('Account key checksum, depth or account index is invalid');
  }
  return { fingerprint: account.fingerprint.toLowerCase(), accountPath, xpub };
}

export function createHardwareSigningFixture(value: unknown) {
  const account = parsePublicAccount(value);
  const node = bip32.fromBase58(account.xpub);
  const key = node.derive(0).derive(0).publicKey;
  const changeKey = node.derive(1).derive(0).publicKey;
  const fingerprint = Buffer.from(account.fingerprint, 'hex');
  const funding = new bitcoin.Transaction();
  // Duplicate inputs violate consensus regardless of chain state. This parent
  // and therefore its signed child cannot transfer funds on either chain.
  const impossibleOutpoint = Buffer.alloc(32, 0x42);
  funding.addInput(impossibleOutpoint, 0);
  funding.addInput(impossibleOutpoint, 0);
  funding.addOutput(bitcoin.payments.p2wpkh({ pubkey: key }).output!, 100_000n);
  const recipient = bitcoin.payments.p2wpkh({
    // Public secp256k1 generator: this is not a live payment destination.
    pubkey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
  });
  const change = bitcoin.payments.p2wpkh({ pubkey: changeKey });
  const request = new bitcoin.Psbt().setVersion(2).setLocktime(0);
  request.addInput({
    hash: funding.getId(),
    index: 0,
    sequence: 0xffffffff,
    nonWitnessUtxo: funding.toBuffer(),
    witnessUtxo: funding.outs[0],
    sighashType: bitcoin.Transaction.SIGHASH_ALL,
    bip32Derivation: [
      {
        masterFingerprint: fingerprint,
        path: account.accountPath + '/0/0',
        pubkey: key,
      },
    ],
  });
  request.addOutput({ address: recipient.address!, value: 40_000n });
  request.addOutput({
    address: change.address!,
    value: 59_000n,
    bip32Derivation: [
      {
        masterFingerprint: fingerprint,
        path: account.accountPath + '/1/0',
        pubkey: changeKey,
      },
    ],
  });
  const review = {
    purpose: FIXTURE_PURPOSE,
    testOnly: true,
    paymentQualified: false,
    fundingInvalidReason: 'duplicate-inputs',
    sighash: 'SIGHASH_ALL (0x01)',
    inputSat: '100000',
    recipientSat: '40000',
    changeSat: '59000',
    feeSat: '1000',
    recipient: recipient.address!,
    change: change.address!,
    inputPath: account.accountPath + '/0/0',
    changePath: account.accountPath + '/1/0',
    fingerprint: account.fingerprint,
    unsignedPsbtSha256: sha256(request.toBuffer()),
    limitations:
      'Offline signature format only. No network acceptance, separation proof, RedWallet UI, camera, funds or hardware qualification is implied.',
  };
  return { request, funding, review };
}

function decodeReturnedBytes(bytes: Uint8Array): Buffer {
  if (!bytes.length || bytes.length > MAX_RETURN_BYTES) throw new Error('Signed return must be nonempty and at most 64 KiB');
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 5).equals(Buffer.from('70736274ff', 'hex'))) return buffer;
  const text = buffer.toString('utf8').trim();
  if (/^(?:[0-9a-fA-F]{2})+$/.test(text)) return Buffer.from(text, 'hex');
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    const decoded = Buffer.from(text, 'base64');
    if (decoded.toString('base64') === text && decoded.subarray(0, 5).equals(Buffer.from('70736274ff', 'hex'))) return decoded;
  }
  throw new Error('Use a binary, hexadecimal or Base64 signed PSBT, or a final transaction in hexadecimal');
}

export function verifyHardwareSigningFixture(value: unknown, returned: Uint8Array) {
  // Regenerate the entire original request from public account data. Never take
  // funding, amounts, recipients or a generic PSBT template from the return.
  const { request, review } = createHardwareSigningFixture(value);
  const decoded = decodeReturnedBytes(returned);
  let tx: bitcoin.Transaction;
  if (decoded.subarray(0, 5).equals(Buffer.from('70736274ff', 'hex'))) {
    const signed = bitcoin.Psbt.fromBuffer(decoded);
    if (!same(signed.data.globalMap.unsignedTx.toBuffer(), request.data.globalMap.unsignedTx.toBuffer()))
      throw new Error('Returned transaction changed the fixture');
    const combined = request.clone().combine(signed);
    if (!combined.data.inputs[0].finalScriptWitness) combined.finalizeAllInputs();
    tx = combined.extractTransaction();
  } else {
    tx = bitcoin.Transaction.fromBuffer(decoded);
  }
  const unsigned = tx.clone();
  for (const input of unsigned.ins) {
    if (input.script.length) throw new Error('Unexpected scriptSig');
    input.witness = [];
  }
  if (!same(unsigned.toBuffer(), request.data.globalMap.unsignedTx.toBuffer())) throw new Error('Returned transaction changed the fixture');
  const [signature, pubkey] = tx.ins[0].witness;
  const expectedKey = request.data.inputs[0].bip32Derivation![0].pubkey;
  if (tx.ins[0].witness.length !== 2 || !signature || !pubkey || !same(pubkey, expectedKey))
    throw new Error('Missing signature or wrong signing key');
  const decodedSignature = bitcoin.script.signature.decode(signature);
  if (decodedSignature.hashType !== bitcoin.Transaction.SIGHASH_ALL) throw new Error('Only SIGHASH_ALL (0x01) is accepted');
  const digest = tx.hashForWitnessV0(0, bitcoin.payments.p2pkh({ pubkey }).output!, 100_000n, bitcoin.Transaction.SIGHASH_ALL);
  if (!ecc.verify(digest, pubkey, decodedSignature.signature)) throw new Error('Invalid returned signature');
  return {
    status: 'offline-fixture-signature-verified',
    testOnly: true,
    paymentQualified: false,
    purpose: FIXTURE_PURPOSE,
    verifiedAt: new Date().toISOString(),
    unsignedPsbtSha256: review.unsignedPsbtSha256,
    signedTransactionSha256: sha256(tx.toBuffer()),
    limitations: review.limitations,
  };
}
