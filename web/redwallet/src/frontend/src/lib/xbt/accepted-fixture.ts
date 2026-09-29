/** Test-only reconstruction of the published native Knots acceptance receipt.
 * Uses existing public signatures, not a wallet seed or private key.
 */
import { Buffer } from "buffer";
import { Psbt, Transaction, script } from "bitcoinjs-lib";
import fixture from "./fixtures/xbt-knots-regtest-acceptance.json";
import { testEcc } from "./test-helpers";
import {
  finalizeUnifiedP2wpkhInput,
  signUnifiedP2wpkhInput,
} from "./unified-psbt";
import { unifiedSegwitV0SighashAll } from "./unified-sighash";

export function verifyRecordedTransaction(hex: string): boolean {
  const transaction = Transaction.fromHex(hex);
  const parents = new Map(
    fixture.fixture.fundingTransactions.map(({ rawTx }) => {
      const parent = Transaction.fromHex(rawTx);
      return [parent.getId(), parent] as const;
    }),
  );
  const spentOutputs = transaction.ins.map((input) => {
    const parent = parents.get(
      Buffer.from(input.hash).reverse().toString("hex"),
    );
    const output = parent?.outs[input.index];
    if (!output) throw new Error("Public fixture parent output is missing");
    return { value: output.value, script: output.script };
  });
  return transaction.ins.every((input, index) => {
    const [signature, publicKey] = input.witness;
    if (!signature || !publicKey || signature.at(-1) !== 0x21) return false;
    const der = Buffer.from(signature);
    der[der.length - 1] = 0x01;
    const compact = script.signature.decode(der).signature;
    const scriptCode = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      Buffer.from(spentOutputs[index].script).subarray(2),
      Buffer.from([0x88, 0xac]),
    ]);
    const digest = unifiedSegwitV0SighashAll(
      transaction,
      index,
      spentOutputs,
      scriptCode,
    );
    return testEcc.verify(digest, publicKey, compact);
  });
}

export function rebuildAcceptedTransaction(): {
  hex: string;
  txid: string;
  fee: bigint;
} {
  const transaction = Transaction.fromHex(fixture.signed.goodHex);
  const parents = new Map(
    fixture.fixture.fundingTransactions.map(({ rawTx }) => {
      const parent = Transaction.fromHex(rawTx);
      return [parent.getId(), parent] as const;
    }),
  );
  const psbt = new Psbt();
  psbt.setVersion(transaction.version);
  psbt.setLocktime(transaction.locktime);
  let totalInput = 0n;
  for (const input of transaction.ins) {
    const parent = parents.get(
      Buffer.from(input.hash).reverse().toString("hex"),
    );
    const output = parent?.outs[input.index];
    if (!output || parent?.isCoinbase())
      throw new Error("Invalid public fixture funding");
    totalInput += output.value;
    psbt.addInput({
      hash: input.hash,
      index: input.index,
      sequence: input.sequence,
      witnessUtxo: output,
    });
  }
  for (const output of transaction.outs) psbt.addOutput(output);
  transaction.ins.forEach((input, index) => {
    const [signature, publicKey] = input.witness;
    const der = Buffer.from(signature);
    if (der.at(-1) !== 0x21)
      throw new Error("Fixture does not use Unified Sighash");
    der[der.length - 1] = 0x01;
    const compact = script.signature.decode(der).signature;
    signUnifiedP2wpkhInput(psbt, index, {
      publicKey,
      sign: (digest) => {
        if (!testEcc.verify(digest, publicKey, compact))
          throw new Error("Recorded signature does not match ported digest");
        return compact;
      },
    });
    finalizeUnifiedP2wpkhInput(psbt, index, publicKey, (key, digest, sig) =>
      testEcc.verify(digest, key, sig),
    );
  });
  const result = Psbt.fromBase64(psbt.toBase64()).extractTransaction();
  return {
    hex: result.toHex(),
    txid: result.getId(),
    fee:
      totalInput - result.outs.reduce((sum, output) => sum + output.value, 0n),
  };
}
