import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { describe, it, expect } from 'vitest';

import vectors from './fixtures/unified-sighash-segwit-v0.json';
import { unifiedSegwitV0SighashAll } from './unified-sighash';

describe('XBT Unified Sighash for SegWit v0 SIGHASH_ALL', () => {
  it.each(vectors.vectors.map((vector, index) => ({ ...vector, index })))('matches upstream Knots vector $index', vector => {
    const transaction = bitcoin.Transaction.fromHex(vector.rawTx);
    const spentOutputs = vector.spentOutputs.map(output => ({
      value: BigInt(output.value),
      script: Buffer.from(output.script, 'hex'),
    }));
    const digest = unifiedSegwitV0SighashAll(transaction, vector.inputIndex, spentOutputs, Buffer.from(vector.scriptCode, 'hex'));
    expect(digest.toString('hex')).toBe(vector.expectedSighash);
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

describe('bitcoinjs-lib Unified Sighash integration boundary', () => {
  it('documents bitcoinjs-lib rejecting the XBT hash type while signing', () => {
    const pubkey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
    const payment = bitcoin.payments.p2wpkh({ pubkey });
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: Buffer.alloc(32, 1),
      index: 0,
      witnessUtxo: { value: 100_000n, script: payment.output! },
      sighashType: 0x21,
    });
    psbt.addOutput({ script: payment.output!, value: 99_000n });

    expect(() => psbt.signInput(0, { publicKey: pubkey, sign: () => Buffer.alloc(64, 1) }, [0x21])).toThrow('Invalid hashType 33');
  });

  it('documents bitcoinjs-lib rejecting an XBT signature while finalizing', () => {
    const pubkey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
    const payment = bitcoin.payments.p2wpkh({ pubkey });
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
      hash: Buffer.alloc(32, 1),
      index: 0,
      witnessUtxo: { value: 100_000n, script: payment.output! },
      sighashType: 0x21,
    });
    psbt.addOutput({ script: payment.output!, value: 99_000n });
    psbt.data.updateInput(0, {
      partialSig: [{ pubkey, signature: Buffer.from('300602010102010121', 'hex') }],
    });

    expect(() => psbt.finalizeInput(0)).toThrow('Invalid hashType 33');
  });
});
