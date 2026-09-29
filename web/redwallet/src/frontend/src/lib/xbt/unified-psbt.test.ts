import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { testEcc as ecc } from "./test-helpers";

import {
  finalizeUnifiedP2wpkhInput,
  signUnifiedP2wpkhInput,
  validateUnifiedP2wpkhInput,
} from "./unified-psbt";

const secretKey = Buffer.from(
  "0000000000000000000000000000000000000000000000000000000000000001",
  "hex",
);
const publicKey = Buffer.from(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
);
const verifySignature = (
  key: Uint8Array,
  hash: Uint8Array,
  signature: Uint8Array,
) => ecc.verify(hash, key, signature);

function createPsbt() {
  const payment = bitcoin.payments.p2wpkh({ pubkey: publicKey });
  const psbt = new bitcoin.Psbt();
  psbt.addInput({
    hash: Buffer.alloc(32, 1),
    index: 0,
    witnessUtxo: { script: payment.output!, value: 100_000n },
  });
  psbt.addOutput({ script: payment.output!, value: 99_000n });
  return { psbt, payment };
}

describe("XBT Unified Sighash P2WPKH PSBT support", () => {
  it("signs, verifies, round-trips, and finalizes with hash type 0x21", () => {
    const { psbt, payment } = createPsbt();
    signUnifiedP2wpkhInput(psbt, 0, {
      publicKey,
      sign: (hash) => ecc.sign(hash, secretKey),
    });

    const encodedSignature = psbt.data.inputs[0].partialSig![0].signature;
    expect(encodedSignature[encodedSignature.length - 1]).toBe(0x21);
    expect(
      validateUnifiedP2wpkhInput(psbt, 0, publicKey, verifySignature),
    ).toBe(true);

    const roundTripped = bitcoin.Psbt.fromBase64(psbt.toBase64());
    expect(
      validateUnifiedP2wpkhInput(roundTripped, 0, publicKey, verifySignature),
    ).toBe(true);
    finalizeUnifiedP2wpkhInput(roundTripped, 0, publicKey, verifySignature);

    const transaction = roundTripped.extractTransaction(true);
    expect(transaction.ins[0].witness).toHaveLength(2);
    expect(
      transaction.ins[0].witness[0][transaction.ins[0].witness[0].length - 1],
    ).toBe(0x21);
    expect(transaction.ins[0].witness[1]).toEqual(publicKey);
    expect(transaction.outs[0].script).toEqual(payment.output);
    const finalizedRoundTrip = bitcoin.Psbt.fromBase64(
      roundTripped.toBase64(),
    ).extractTransaction(true);
    expect(finalizedRoundTrip.toHex()).toBe(transaction.toHex());
  });

  it("commits to every input amount before allowing finalization", () => {
    const { psbt, payment } = createPsbt();
    psbt.addInput({
      hash: Buffer.alloc(32, 2),
      index: 1,
      witnessUtxo: { script: payment.output!, value: 50_000n },
    });
    psbt.addOutput({ script: payment.output!, value: 149_000n });
    signUnifiedP2wpkhInput(psbt, 0, {
      publicKey,
      sign: (hash) => ecc.sign(hash, secretKey),
    });

    expect(
      validateUnifiedP2wpkhInput(psbt, 0, publicKey, verifySignature),
    ).toBe(true);
    psbt.data.inputs[1].witnessUtxo!.value = 50_001n;
    expect(
      validateUnifiedP2wpkhInput(psbt, 0, publicKey, verifySignature),
    ).toBe(false);
  });

  it("rejects a key that does not control the P2WPKH input", () => {
    const { psbt } = createPsbt();
    const wrongSecret = Buffer.from(
      "0000000000000000000000000000000000000000000000000000000000000002",
      "hex",
    );
    const wrongPublicKey = Buffer.from(ecc.pointFromScalar(wrongSecret, true)!);

    expect(() =>
      signUnifiedP2wpkhInput(psbt, 0, {
        publicKey: wrongPublicKey,
        sign: (hash) => ecc.sign(hash, wrongSecret),
      }),
    ).toThrow("Signing key does not match the P2WPKH witness UTXO");
  });

  it("rejects a signature that does not verify against the Unified digest", () => {
    const { psbt } = createPsbt();
    signUnifiedP2wpkhInput(psbt, 0, {
      publicKey,
      sign: (hash) => ecc.sign(hash, secretKey),
    });
    const signature = psbt.data.inputs[0].partialSig![0].signature;
    signature[8] = signature[8] + 1;

    expect(
      validateUnifiedP2wpkhInput(psbt, 0, publicKey, verifySignature),
    ).toBe(false);
    expect(() =>
      finalizeUnifiedP2wpkhInput(psbt, 0, publicKey, verifySignature),
    ).toThrow("Unified P2WPKH signature validation failed");
  });
});
