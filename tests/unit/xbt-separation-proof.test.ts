import { Transaction, crypto } from 'bitcoinjs-lib';
import { verifyFundingConflict } from '../../class/xbt/separation-proof';

function fixture() {
  const funding = new Transaction();
  funding.addInput(Buffer.alloc(32, 1), 0);
  funding.addOutput(Buffer.from('0014' + '02'.repeat(20), 'hex'), 1000n);
  const conflict = funding.clone();
  conflict.outs[0].value = 900n;
  const sibling = Buffer.alloc(32, 3);
  const header = Buffer.alloc(80);
  Buffer.from(crypto.hash256(Buffer.concat([sibling, conflict.getHash()]))).copy(header, 36);
  const anchor = {
    height: 1000000,
    tipHeight: 1000005,
    txCount: 2,
    blockHash: Buffer.from(crypto.hash256(header)).reverse().toString('hex'),
  };
  const proof = {
    rawTransaction: conflict.toHex(),
    header: header.toString('hex'),
    position: 1,
    merkle: [Buffer.from(sibling).reverse().toString('hex')],
  };
  return { funding, conflict, anchor, proof };
}
it('accepts a different spending body included in the separately anchored BTC block', () => {
  const f = fixture();
  expect(verifyFundingConflict(f.funding, f.proof, f.anchor)).toBe(f.conflict.getId());
});
it('rejects a witness-only change sharing the funding txid', () => {
  const f = fixture();
  f.funding.ins[0].witness = [Buffer.from('abcd', 'hex')];
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, rawTransaction: f.funding.toHex() }, f.anchor)).toThrow();
});
it('rejects unrelated inputs even if the inclusion proof matches', () => {
  const f = fixture();
  f.funding.ins[0].index = 1;
  expect(() => verifyFundingConflict(f.funding, f.proof, f.anchor)).toThrow();
});
it.each([0, 1000001, 1000006])('rejects immature, stale or pre-fork anchor %s', height => {
  const f = fixture();
  expect(() => verifyFundingConflict(f.funding, f.proof, { ...f.anchor, height })).toThrow();
});
it('rejects a reorged anchor, forged header, changed transaction and missing branch', () => {
  const f = fixture();
  expect(() => verifyFundingConflict(f.funding, f.proof, { ...f.anchor, blockHash: 'ff'.repeat(32) })).toThrow();
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, header: '00'.repeat(80) }, f.anchor)).toThrow();
  f.conflict.outs[0].value = 800n;
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, rawTransaction: f.conflict.toHex() }, f.anchor)).toThrow();
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, merkle: [] }, f.anchor)).toThrow();
});
it.each([-1, 0, 3, 1.5, Number.MAX_SAFE_INTEGER])('rejects invalid merkle position %s', position => {
  const f = fixture();
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, position }, f.anchor)).toThrow();
});
it('rejects malformed hashes and excessive branches', () => {
  const f = fixture();
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, merkle: ['zz'.repeat(32)] }, f.anchor)).toThrow();
  expect(() => verifyFundingConflict(f.funding, { ...f.proof, merkle: Array(33).fill('00'.repeat(32)) }, f.anchor)).toThrow();
});

it('accepts the duplicated last leaf at an odd-width level with anchored tree size', () => {
  const f = fixture();
  const leaf = Buffer.from(f.conflict.getHash());
  const left = Buffer.alloc(32, 8);
  const right = Buffer.from(crypto.hash256(Buffer.concat([leaf, leaf])));
  const header = Buffer.alloc(80);
  Buffer.from(crypto.hash256(Buffer.concat([left, right]))).copy(header, 36);
  const anchor = { ...f.anchor, txCount: 3, blockHash: Buffer.from(crypto.hash256(header)).reverse().toString('hex') };
  const proof = {
    ...f.proof,
    position: 2,
    header: header.toString('hex'),
    merkle: [Buffer.from(leaf).reverse().toString('hex'), Buffer.from(left).reverse().toString('hex')],
  };
  expect(verifyFundingConflict(f.funding, proof, anchor)).toBe(f.conflict.getId());
  expect(() => verifyFundingConflict(f.funding, proof, { ...anchor, txCount: 4 })).toThrow();
});
it('rejects proofs at a different tree depth from the independent anchor', () => {
  const f = fixture();
  expect(() => verifyFundingConflict(f.funding, f.proof, { ...f.anchor, txCount: 5 })).toThrow();
});

it('verifies parsed transaction inputs with the mobile Buffer implementation', () => {
  const f = fixture();
  // bitcoinjs v7 parses hashes as Uint8Array. Node Buffer accepts these in
  // equals(), but the Buffer polyfill used by the mobile app requires a Buffer.
  const funding = Transaction.fromHex(f.funding.toHex());
  expect(Buffer.isBuffer(funding.ins[0].hash)).toBe(false);
  const nodeBuffer = global.Buffer;
  const mobileBuffer = require('buffer/').Buffer;
  const species = Object.getOwnPropertyDescriptor(mobileBuffer, Symbol.species);
  // Exercise engines that return a plain Uint8Array from a typed-array view.
  Object.defineProperty(mobileBuffer, Symbol.species, { value: Uint8Array, configurable: true });
  expect(mobileBuffer.isBuffer(mobileBuffer.alloc(80).subarray(36, 68))).toBe(false);
  try {
    global.Buffer = mobileBuffer;
    expect(verifyFundingConflict(funding, f.proof, f.anchor)).toBe(f.conflict.getId());
    const badHeader = Buffer.from(f.proof.header, 'hex');
    badHeader[36] = (badHeader[36] + 1) % 256;
    expect(() =>
      verifyFundingConflict(
        funding,
        { ...f.proof, header: badHeader.toString('hex') },
        { ...f.anchor, blockHash: Buffer.from(crypto.hash256(badHeader)).reverse().toString('hex') },
      ),
    ).toThrow('Coin separation proof is invalid or insufficiently confirmed');
    // A different hash with the same output index is still unrelated.
    funding.ins[0].hash[0] = (funding.ins[0].hash[0] + 1) % 256;
    expect(() => verifyFundingConflict(funding, f.proof, f.anchor)).toThrow('Coin separation proof is invalid or insufficiently confirmed');
  } finally {
    global.Buffer = nodeBuffer;
    if (species) Object.defineProperty(mobileBuffer, Symbol.species, species);
    else delete mobileBuffer[Symbol.species];
  }
});
