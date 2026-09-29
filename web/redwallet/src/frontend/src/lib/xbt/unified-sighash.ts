/** Ported from native RedWallet eebada6df, class/xbt/unified-sighash.ts.
 * Isolated browser-compatible core; no key storage, network, or UI integration.
 */
import { Buffer } from "buffer";
import { crypto, type Transaction } from "bitcoinjs-lib";

export type SpentOutput = {
  value: bigint;
  script: Uint8Array;
};

const SIGHASH_ALL_UNIFIED = 0x21;
const SEGWIT_V0_SCRIPT_TYPE = 0x01;
const UNIFIED_SIGHASH_TAG = Buffer.from("UnifiedSighash", "utf8");

function sha256(data: Uint8Array): Buffer {
  return Buffer.from(crypto.sha256(data));
}

function u32LE(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("Value is outside uint32 range");
  }
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function compactSize(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid compact-size value");
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const out = Buffer.alloc(3);
    out[0] = 0xfd;
    out.writeUInt16LE(value, 1);
    return out;
  }
  if (value <= 0xffffffff) {
    return Buffer.concat([Buffer.from([0xfe]), u32LE(value)]);
  }
  const out = Buffer.alloc(9);
  out[0] = 0xff;
  out.writeBigUInt64LE(BigInt(value), 1);
  return out;
}

function serializeBytes(value: Uint8Array): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([compactSize(bytes.length), bytes]);
}

function serializeInt64LE(value: bigint, signed: boolean): Buffer {
  if (value < 0n || value > 0x7fffffffffffffffn)
    throw new Error("Amount is outside int64 range");
  const out = Buffer.alloc(8);
  if (signed) out.writeBigInt64LE(value);
  else out.writeBigUInt64LE(value);
  return out;
}

/**
 * Computes the XBT Unified Sighash digest for a SegWit v0 input using SIGHASH_ALL.
 * The caller must provide every spent output, in transaction input order, from
 * trustworthy PSBT UTXO data. For P2WPKH, scriptCode must be the implied P2PKH script.
 * This function does not sign or finalize a PSBT.
 */
export function unifiedSegwitV0SighashAll(
  transaction: Transaction,
  inputIndex: number,
  spentOutputs: SpentOutput[],
  scriptCode: Uint8Array,
): Buffer {
  if (
    !Number.isInteger(inputIndex) ||
    inputIndex < 0 ||
    inputIndex >= transaction.ins.length
  ) {
    throw new Error("Input index is outside the transaction");
  }
  if (spentOutputs.length !== transaction.ins.length) {
    throw new Error("A spent output is required for every transaction input");
  }
  // Buffer and Uint8Array are accepted; reject accidental string input.
  if (!(scriptCode instanceof Uint8Array))
    throw new Error("scriptCode must be bytes");
  for (const output of spentOutputs) {
    if (
      typeof output.value !== "bigint" ||
      output.value < 0n ||
      output.value > 0x7fffffffffffffffn
    ) {
      throw new Error("Spent output amount is outside int64 range");
    }
  }

  const hashes = Buffer.concat(
    transaction.ins.map((input) => {
      if (input.hash.length !== 32)
        throw new Error("Transaction input hash must be 32 bytes");
      return Buffer.concat([Buffer.from(input.hash), u32LE(input.index)]);
    }),
  );
  const amounts = Buffer.concat(
    spentOutputs.map((output) => serializeInt64LE(output.value, true)),
  );
  const scripts = Buffer.concat(
    spentOutputs.map((output) => serializeBytes(output.script)),
  );
  const sequences = Buffer.concat(
    transaction.ins.map((input) => u32LE(input.sequence)),
  );
  const outputs = Buffer.concat(
    transaction.outs.map((output) => {
      return Buffer.concat([
        serializeInt64LE(output.value, false),
        serializeBytes(output.script),
      ]);
    }),
  );

  const version = Buffer.alloc(4);
  version.writeInt32LE(transaction.version);
  const locktime = Buffer.alloc(5);
  locktime.writeUInt32LE(transaction.locktime, 0);
  const index = u32LE(inputIndex);

  const message = Buffer.concat([
    Buffer.from([0x00, SIGHASH_ALL_UNIFIED]),
    version,
    locktime,
    sha256(hashes),
    sha256(amounts),
    sha256(scripts),
    sha256(sequences),
    sha256(outputs),
    Buffer.from([SEGWIT_V0_SCRIPT_TYPE]),
    index,
    serializeBytes(scriptCode),
  ]);

  const tagHash = sha256(UNIFIED_SIGHASH_TAG);
  return sha256(Buffer.concat([tagHash, tagHash, message]));
}
