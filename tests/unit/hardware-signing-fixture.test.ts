import BIP32Factory from 'bip32';
import bs58check from 'bs58check';
import * as bitcoin from 'bitcoinjs-lib';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import ecc from '../../blue_modules/noble_ecc';
import { assertStandardHardwareResult } from '../../class/xbt/standard-hardware';
import {
  createHardwareSigningFixture,
  parsePublicAccount,
  verifyHardwareSigningFixture,
} from '../../scripts/diagnostics/hardware-signing-fixture';

const master = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 1)); // public disposable test vector only
const accountPath = "m/84'/0'/0'";
const node = master.derivePath(accountPath);
const account = {
  fingerprint: Buffer.from(master.fingerprint).toString('hex'),
  accountPath,
  xpub: node.neutered().toBase58(),
};
const key = node.derive(0).derive(0);
const signed = () => createHardwareSigningFixture(account).request.signInput(0, key);
const bytes = (text: string) => Buffer.from(text, 'utf8');

test('fixture preserves public origins, complete parent, change and exact fixed amounts; parent has duplicate inputs', () => {
  const { request, funding, review } = createHardwareSigningFixture(account);
  expect(funding.ins).toHaveLength(2);
  expect(funding.ins[0].hash).toEqual(funding.ins[1].hash);
  expect(funding.ins[0].index).toBe(funding.ins[1].index);
  expect(request.data.inputs[0].nonWitnessUtxo).toEqual(funding.toBuffer());
  expect(request.data.inputs[0].bip32Derivation![0].path).toBe(accountPath + '/0/0');
  expect(request.data.outputs[1].bip32Derivation![0].path).toBe(accountPath + '/1/0');
  expect(Buffer.from(request.data.inputs[0].bip32Derivation![0].masterFingerprint).toString('hex')).toBe(account.fingerprint);
  expect(request.txOutputs.map(o => o.value)).toEqual([40000n, 59000n]);
  expect(review).toMatchObject({
    testOnly: true,
    paymentQualified: false,
    feeSat: '1000',
    fundingInvalidReason: 'duplicate-inputs',
  });
  expect(JSON.stringify(review)).not.toContain(account.xpub);
});

test('accepts equivalent mainnet zpub and h notation, validating checksum/depth/index', () => {
  const payload = Buffer.from(bs58check.decode(account.xpub));
  payload.writeUInt32BE(0x04b24746, 0);
  expect(
    parsePublicAccount({
      ...account,
      xpub: bs58check.encode(payload),
      accountPath: 'm/84h/0h/0h',
    }),
  ).toEqual(account);
});

test.each([
  null,
  [],
  { ...account, seed: 'never accepted' },
  { ...account, xpub: node.toBase58() },
  { ...account, xpub: master.neutered().toBase58() },
  { ...account, accountPath: "m/84'/0'/1'" },
  { ...account, accountPath: "m/84'/1'/0'" },
  { ...account, accountPath: "m/86'/0'/0'" },
  { ...account, accountPath: "m/84'/0'/00'" },
  { ...account, accountPath: "m/84'/0'/2147483648'" },
  { ...account, fingerprint: '123' },
  { ...account, fingerprint: 12345678 },
  { ...account, xpub: account.xpub.slice(0, -4) + '1111' },
])('rejects private material, wrong network/account and malformed public account %#', value => {
  expect(() => createHardwareSigningFixture(value)).toThrow();
});

test.each(['binary', 'base64', 'psbt-hex', 'final-psbt', 'raw-hex'])(
  'verifies %s return and agrees with production signature validation',
  format => {
    const p = signed();
    let returned: Uint8Array;
    if (format === 'binary') returned = p.toBuffer();
    else if (format === 'base64') returned = bytes(p.toBase64());
    else if (format === 'psbt-hex') returned = bytes(p.toHex());
    else {
      p.finalizeAllInputs();
      returned = format === 'final-psbt' ? p.toBuffer() : bytes(p.extractTransaction().toHex());
    }
    const receipt = verifyHardwareSigningFixture(account, returned);
    expect(receipt).toMatchObject({
      status: 'offline-fixture-signature-verified',
      testOnly: true,
      paymentQualified: false,
    });
    const tx = signed().finalizeAllInputs().extractTransaction();
    expect(assertStandardHardwareResult(tx.toHex(), createHardwareSigningFixture(account).request).getId()).toBe(tx.getId());
  },
);

test.each(['amount', 'destination', 'sequence', 'locktime', 'prevout'])(
  'rejects a changed reviewed %s even with a valid signature on changed body',
  field => {
    const original = createHardwareSigningFixture(account).request;
    const tx = bitcoin.Transaction.fromBuffer(original.data.globalMap.unsignedTx.toBuffer());
    if (field === 'amount') tx.outs[0].value--;
    if (field === 'destination')
      tx.outs[0].script = bitcoin.payments.p2wpkh({
        pubkey: node.derive(0).derive(2).publicKey,
      }).output!;
    if (field === 'sequence') tx.ins[0].sequence--;
    if (field === 'locktime') tx.locktime++;
    if (field === 'prevout') tx.ins[0].index++;
    const digest = tx.hashForWitnessV0(0, bitcoin.payments.p2pkh({ pubkey: key.publicKey }).output!, 100000n, 1);
    tx.setWitness(0, [bitcoin.script.signature.encode(key.sign(digest), 1), key.publicKey]);
    expect(() => verifyHardwareSigningFixture(account, bytes(tx.toHex()))).toThrow('changed the fixture');
  },
);

test.each(['corrupted', 'wrong-key', 'wrong-sighash', 'extra-witness', 'scriptSig'])(
  'rejects invalid signature representation: %s',
  kind => {
    const tx = signed().finalizeAllInputs().extractTransaction();
    if (kind === 'corrupted') tx.ins[0].witness[0][10] = (tx.ins[0].witness[0][10] + 1) % 256;
    if (kind === 'wrong-key') tx.ins[0].witness[1] = node.derive(0).derive(1).publicKey;
    if (kind === 'wrong-sighash') tx.ins[0].witness[0][tx.ins[0].witness[0].length - 1] = 0x21;
    if (kind === 'extra-witness') tx.ins[0].witness.push(Buffer.alloc(1));
    if (kind === 'scriptSig') tx.ins[0].script = Buffer.from([0]);
    expect(() => verifyHardwareSigningFixture(account, bytes(tx.toHex()))).toThrow();
  },
);

test.each([Buffer.alloc(0), Buffer.alloc(65537), bytes('not a PSBT'), bytes('00'), bytes('cHNidP8=garbage')])(
  'rejects malformed or excessive return %#',
  value => {
    expect(() => verifyHardwareSigningFixture(account, value)).toThrow();
  },
);
test('rejects unsigned and unrelated account returns', () => {
  expect(() => verifyHardwareSigningFixture(account, createHardwareSigningFixture(account).request.toBuffer())).toThrow();
  const other = {
    ...account,
    xpub: BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 2)).derivePath(accountPath).neutered().toBase58(),
  };
  expect(() => verifyHardwareSigningFixture(other, signed().toBuffer())).toThrow();
});

test('CLI creates only private local files, verifies real signatures, refuses overwrites and writes no receipt on failure', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'redwallet-offline-fixture-'));
  try {
    const cli = path.resolve(__dirname, '../../scripts/diagnostics/hardware-signing-fixture.cjs');
    const accountFile = path.join(dir, 'account.json');
    const out = path.join(dir, 'fixture');
    const signedFile = path.join(dir, 'signed.psbt');
    const receipt = path.join(dir, 'receipt.json');
    writeFileSync(accountFile, JSON.stringify(account));
    const run = (...args: string[]) =>
      execFileSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    expect(run('generate', accountFile, out)).toContain('invalid-funding');
    expect(statSync(out).mode % 0o1000).toBe(0o700);
    const unsignedFile = path.join(out, 'OFFLINE-TEST-NEVER-BROADCAST.psbt');
    expect(statSync(unsignedFile).mode % 0o1000).toBe(0o600);
    expect(readFileSync(unsignedFile)).toEqual(Buffer.from(createHardwareSigningFixture(account).request.toBuffer()));
    expect(() => run('generate', accountFile, out)).toThrow();
    writeFileSync(signedFile, createHardwareSigningFixture(account).request.toBuffer());
    expect(() => run('verify', accountFile, signedFile, receipt)).toThrow();
    expect(existsSync(receipt)).toBe(false);
    writeFileSync(signedFile, signed().toBuffer());
    expect(run('verify', accountFile, signedFile, receipt)).toContain('signature verified');
    expect(JSON.parse(readFileSync(receipt, 'utf8')).paymentQualified).toBe(false);
    const saved = readFileSync(receipt);
    expect(() => run('verify', accountFile, signedFile, receipt)).toThrow();
    expect(readFileSync(receipt)).toEqual(saved);
    writeFileSync(accountFile, JSON.stringify({ ...account, seed: 'DO-NOT-PRINT-THIS' }));
    try {
      run('generate', accountFile, path.join(dir, 'bad'));
      throw new Error('unexpected success');
    } catch (error: any) {
      expect(String(error.stderr)).not.toContain('DO-NOT-PRINT-THIS');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
