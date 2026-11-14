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
  const anchor = { height: 1000000, tipHeight: 1000005, blockHash: Buffer.from(crypto.hash256(header)).reverse().toString('hex') };
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
