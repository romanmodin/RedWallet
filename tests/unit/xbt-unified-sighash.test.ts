import * as bitcoin from 'bitcoinjs-lib';

import vectors from './fixtures/unified-sighash-segwit-v0.json';
import { unifiedSegwitV0SighashAll } from '../../class/xbt/unified-sighash';

describe('XBT Unified Sighash for SegWit v0 SIGHASH_ALL', () => {
  it('matches the upstream Knots vectors', () => {
    expect(vectors.vectors).toHaveLength(8);

    for (const vector of vectors.vectors) {
      const transaction = bitcoin.Transaction.fromHex(vector.rawTx);
      const spentOutputs = vector.spentOutputs.map(output => ({
        value: BigInt(output.value),
        script: Buffer.from(output.script, 'hex'),
      }));
      const digest = unifiedSegwitV0SighashAll(transaction, vector.inputIndex, spentOutputs, Buffer.from(vector.scriptCode, 'hex'));
      expect(digest.toString('hex')).toBe(vector.expectedSighash);
    }
  });

  it('rejects a missing spent output rather than hashing incomplete PSBT data', () => {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(Buffer.alloc(32), 0);
    transaction.addOutput(Buffer.from([0x51]), 1n);

    expect(() => unifiedSegwitV0SighashAll(transaction, 0, [], Buffer.from([0x51]))).toThrow(
      'A spent output is required for every transaction input',
    );
  });

  it('rejects an invalid input index', () => {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(Buffer.alloc(32), 0);
    transaction.addOutput(Buffer.from([0x51]), 1n);

    expect(() => unifiedSegwitV0SighashAll(transaction, 1, [{ value: 1n, script: Buffer.from([0x51]) }], Buffer.from([0x51]))).toThrow(
      'Input index is outside the transaction',
    );
  });
});
