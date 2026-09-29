/** Test-only browser bundle entry. No application route imports this file. */
import { Buffer } from "buffer";
import { Psbt, Transaction, payments } from "bitcoinjs-lib";
import {
  rebuildAcceptedTransaction,
  verifyRecordedTransaction,
} from "./accepted-fixture";
import vectors from "./fixtures/unified-sighash-segwit-v0.json";
import fixture from "./fixtures/xbt-knots-regtest-acceptance.json";
import { XbtKeySession, publicAddress } from "./key-material";
import { testEcc } from "./test-helpers";
import {
  finalizeUnifiedP2wpkhInput,
  signUnifiedP2wpkhInput,
} from "./unified-psbt";
import { unifiedSegwitV0SighashAll } from "./unified-sighash";
import { openVault, sealVault } from "./vault";

export async function runBrowserVaultChecks() {
  const phrase =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const session = new XbtKeySession(phrase);
  const address = session.account.firstAddress;
  if (
    address !== "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu" ||
    publicAddress(session.account.accountXpub, 1, 0) !==
      "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"
  )
    throw Error("Browser BIP84 mismatch");
  const vault = await sealVault(
    { mnemonic: phrase, passphrase: "" },
    "public browser fixture password",
  );
  const recovered = await openVault(
    JSON.stringify(vault),
    "public browser fixture password",
  );
  if (recovered.mnemonic !== phrase)
    throw Error("Browser vault round trip failed");
  session.destroy();
  return { bip84: true, vault: true, locked: session.locked };
}

export function runBrowserCoreChecks(): {
  vectors: number;
  acceptedTxid: string;
  signedSighash: number;
} {
  for (const vector of vectors.vectors) {
    const digest = unifiedSegwitV0SighashAll(
      Transaction.fromHex(vector.rawTx),
      vector.inputIndex,
      vector.spentOutputs.map((output) => ({
        value: BigInt(output.value),
        script: Buffer.from(output.script, "hex"),
      })),
      Buffer.from(vector.scriptCode, "hex"),
    );
    if (digest.toString("hex") !== vector.expectedSighash)
      throw new Error("Browser digest vector mismatch");
  }
  const rebuilt = rebuildAcceptedTransaction();
  if (
    rebuilt.hex !== fixture.signed.goodHex ||
    !verifyRecordedTransaction(rebuilt.hex)
  )
    throw new Error("Browser accepted transaction mismatch");
  if (
    verifyRecordedTransaction(fixture.signed.negativeControls.changedOutputHex)
  )
    throw new Error("Browser accepted changed output");
  if (
    verifyRecordedTransaction(
      fixture.signed.negativeControls.removedUnifiedBitHex,
    )
  )
    throw new Error("Browser accepted stripped flag");

  // Public synthetic scalar 1, strictly a test vector, never a wallet key.
  const key = new Uint8Array(32);
  key[31] = 1;
  const publicKey = testEcc.pointFromScalar(key);
  const payment = payments.p2wpkh({ pubkey: publicKey });
  const psbt = new Psbt();
  psbt.addInput({
    hash: new Uint8Array(32).fill(1),
    index: 0,
    witnessUtxo: { script: payment.output!, value: 100_000n },
  });
  psbt.addOutput({ script: payment.output!, value: 99_000n });
  signUnifiedP2wpkhInput(psbt, 0, {
    publicKey,
    sign: (digest) => testEcc.sign(digest, key),
  });
  finalizeUnifiedP2wpkhInput(psbt, 0, publicKey, (pub, digest, signature) =>
    testEcc.verify(digest, pub, signature),
  );
  const signedSighash = psbt.extractTransaction().ins[0].witness[0].at(-1)!;
  if (signedSighash !== 0x21)
    throw new Error("Browser signer omitted Unified flag");
  return {
    vectors: vectors.vectors.length,
    acceptedTxid: rebuilt.txid,
    signedSighash,
  };
}
