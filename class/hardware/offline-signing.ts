/** Offline signature-format qualification only. No network, keys, wallet state or broadcast. */
import { sha256 as hashBytes } from '@noble/hashes/sha256';
import BIP32Factory from 'bip32';
import bs58check from 'bs58check';
import * as bitcoin from 'bitcoinjs-lib';
import { assertStandardHardwareResult, combineStandardHardwareResult } from '../xbt/standard-hardware';
import { parseSignedScan } from './signed-scan';
import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const sha256 = (bytes: Uint8Array) => Buffer.from(hashBytes(bytes)).toString('hex');
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

type FixtureMode = 'single' | 'send';

export function createHardwareSigningFixture(value: unknown, mode: FixtureMode = 'single') {
  const account = parsePublicAccount(value);
  const node = bip32.fromBase58(account.xpub);
  const receive = node.derive(0);
  const changeKey = node.derive(1).derive(0).publicKey;
  const fingerprint = Buffer.from(account.fingerprint, 'hex');
  const inputValues = mode === 'send' ? [40_000n, 35_000n, 25_000n] : [100_000n];
  const request = new bitcoin.Psbt().setVersion(2).setLocktime(0);
  const parents = inputValues.map((amount, index) => {
    const key = receive.derive(index).publicKey;
    const parent = new bitcoin.Transaction();
    // Each parent independently violates consensus on both chains.
    const impossibleOutpoint = Buffer.alloc(32, 0x42 + index);
    parent.addInput(impossibleOutpoint, 0);
    parent.addInput(impossibleOutpoint, 0);
    parent.addOutput(bitcoin.payments.p2wpkh({ pubkey: key }).output!, amount);
    request.addInput({
      hash: parent.getId(),
      index: 0,
      sequence: 0xffffffff,
      nonWitnessUtxo: parent.toBuffer(),
      witnessUtxo: parent.outs[0],
      sighashType: bitcoin.Transaction.SIGHASH_ALL,
      bip32Derivation: [{ masterFingerprint: fingerprint, path: account.accountPath + '/0/' + index, pubkey: key }],
    });
    return parent;
  });
  const recipient = bitcoin.payments.p2wpkh({
    // Public secp256k1 generator: this is not a live payment destination.
    pubkey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
  });
  const change = bitcoin.payments.p2wpkh({ pubkey: changeKey });
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
    inputCount: parents.length,
    inputSat: '100000',
    recipientSat: '40000',
    changeSat: '59000',
    feeSat: '1000',
    recipient: recipient.address!,
    change: change.address!,
    ...(mode === 'single'
      ? { inputPath: account.accountPath + '/0/0' }
      : { inputPaths: parents.map((_, index) => account.accountPath + '/0/' + index) }),
    changePath: account.accountPath + '/1/0',
    fingerprint: account.fingerprint,
    unsignedPsbtSha256: sha256(request.toBuffer()),
    limitations:
      'Offline signature format only. No network acceptance, separation proof, RedWallet UI, camera, funds or hardware qualification is implied.',
  };
  return { request, funding: parents[0], parents, review };
}

export function verifyHardwareSigningFixture(value: unknown, returned: Uint8Array, mode: FixtureMode = 'single') {
  if (!returned.length || returned.length > MAX_RETURN_BYTES) throw new Error('Signed return must be nonempty and at most 64 KiB');
  // Reconstruct the transaction and all parents from public information held in memory.
  const { request, review } = createHardwareSigningFixture(value, mode);
  const bytes = Buffer.from(returned);
  const scan = same(bytes.subarray(0, 5), Buffer.from('70736274ff', 'hex'))
    ? { kind: 'psbt' as const, psbt: bitcoin.Psbt.fromBuffer(bytes) }
    : parseSignedScan(bytes.toString('utf8'));
  let tx: bitcoin.Transaction;
  if (scan.kind === 'psbt') {
    if (typeof scan.psbt === 'string' && Buffer.from(scan.psbt, 'base64').toString('base64') !== scan.psbt)
      throw new Error('Use a canonical Base64 PSBT');
    const signed = typeof scan.psbt === 'string' ? bitcoin.Psbt.fromBase64(scan.psbt) : scan.psbt;
    if (!same(signed.data.globalMap.unsignedTx.toBuffer(), request.data.globalMap.unsignedTx.toBuffer()))
      throw new Error('Returned transaction changed the fixture');
    tx = combineStandardHardwareResult(request, signed);
  } else {
    // Only the historical single-input diagnostic accepts a raw final transaction.
    if (mode === 'send') throw new Error('Scan a signed PSBT for the current transaction.');
    const raw = bitcoin.Transaction.fromHex(scan.hex);
    const unsigned = raw.clone();
    for (const input of unsigned.ins) input.witness = [];
    if (!same(unsigned.toBuffer(), request.data.globalMap.unsignedTx.toBuffer()))
      throw new Error('Returned transaction changed the fixture');
    tx = assertStandardHardwareResult(scan.hex, request);
  }
  return {
    status: 'offline-fixture-signature-verified',
    testOnly: true,
    paymentQualified: false,
    purpose: FIXTURE_PURPOSE,
    verifiedAt: new Date().toISOString(),
    unsignedPsbtSha256: review.unsignedPsbtSha256,
    signedTransactionSha256: sha256(tx.toBuffer()),
    verifiedInputs: tx.ins.length,
    limitations: review.limitations,
  };
}

/** Convert the scanner's public-account export, never a seed or signing request. */
export function parseHardwareCheckAccount(text: string): PublicAccount {
  if (typeof text !== 'string' || text.length === 0 || text.length > 16 * 1024)
    throw new Error('A bounded public account export is required');
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) return parsePublicAccount(value);
  if (!value.length || value.length > 32) throw new Error('Export one Native SegWit account');
  const candidates: PublicAccount[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).sort().join(',') !== 'AccountKeyPath,ExtPubKey,MasterFingerprint'
    )
      throw new Error('Only public account metadata is accepted');
    const { AccountKeyPath, ExtPubKey, MasterFingerprint } = item;
    if (
      typeof AccountKeyPath !== 'string' ||
      typeof ExtPubKey !== 'string' ||
      typeof MasterFingerprint !== 'string' ||
      !/^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,120}$/.test(ExtPubKey)
    )
      throw new Error('Only public account metadata is accepted');
    if (/^m\/84['h]\/0['h]\//.test(AccountKeyPath))
      candidates.push(parsePublicAccount({ accountPath: AccountKeyPath, xpub: ExtPubKey, fingerprint: MasterFingerprint }));
  }
  if (candidates.length !== 1) throw new Error('Export exactly one Native SegWit account');
  return candidates[0];
}
