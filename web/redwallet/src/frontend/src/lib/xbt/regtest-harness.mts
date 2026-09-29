/** Opt-in CLI harness: public BIP84 fixture only. No RPC or broadcast. */
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Transaction, address, payments, script } from "bitcoinjs-lib";
import { XbtKeySession, publicAddress, publicKeyAt } from "./key-material";
import {
  type CandidateCoin,
  planSpend,
  reviewDigest,
  signReviewedPlan,
} from "./spend-plan";

const [fixturePath, resultPath] = process.argv.slice(2);
if (
  !fixturePath ||
  !resultPath ||
  !isAbsolute(fixturePath) ||
  !isAbsolute(resultPath) ||
  resolve(fixturePath) === resolve(resultPath)
) {
  throw Error("Provide distinct absolute fixture and result paths");
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
if (
  fixture.chain !== "regtest" ||
  !Number.isSafeInteger(fixture.height) ||
  fixture.height < 1 ||
  !["XBT Knots", "Bitcoin Core"].includes(fixture.implementation) ||
  fixture.networkactive !== false ||
  fixture.connections !== 0
)
  throw Error("Isolated regtest evidence required");
if (
  fixture.implementation === "XBT Knots" &&
  (fixture.blake2b?.active !== true || fixture.blake2b.height > fixture.height)
) {
  throw Error("Activated XBT evidence required");
}
// This phrase is a published, public test vector. NEVER use it for actual funds.
const keys = new XbtKeySession(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
);
try {
  const parent = Transaction.fromHex(fixture.fundingHex);
  if (parent.isCoinbase() || parent.getId() !== fixture.fundingTxid)
    throw Error("Invalid regtest parent");
  const coins: CandidateCoin[] = [60000n, 40000n].map((value, index) => {
    const outputScript = address.toOutputScript(
      publicAddress(keys.account.accountXpub, 0, index),
    );
    const matches = parent.outs
      .map((out, vout) => ({ out, vout }))
      .filter(
        ({ out }) =>
          out.value === value &&
          Buffer.from(out.script).equals(Buffer.from(outputScript)),
      );
    if (matches.length !== 1)
      throw Error("Expected unique public fixture output");
    return {
      txid: parent.getId(),
      vout: matches[0]!.vout,
      value: value.toString(),
      height: fixture.height,
      branch: 0,
      index,
      parentHex: parent.toHex(),
    };
  });
  const plan = planSpend({
    accountXpub: keys.account.accountXpub,
    coins,
    destination: publicAddress(keys.account.accountXpub, 0, 2),
    amountXbt: "0.0009",
    feeRate: 1,
    changeIndex: 0,
    tipHeight: fixture.height,
  });
  const signed = signReviewedPlan(plan, reviewDigest(plan), keys);
  const tx = Transaction.fromHex(signed.hex);
  if (
    tx.ins.length !== 2 ||
    tx.ins.some((input) => input.witness[0]?.at(-1) !== 0x21)
  )
    throw Error("Expected two Unified signatures");
  const changedOutput = Transaction.fromHex(signed.hex);
  changedOutput.outs[0]!.value -= 1n;
  const stripped = Transaction.fromHex(signed.hex);
  for (const input of stripped.ins)
    input.witness[0]![input.witness[0]!.length - 1] = 1;
  // Positive Bitcoin control: identical non-witness bytes and different digests.
  const bitcoinControl = Transaction.fromHex(signed.hex);
  for (let i = 0; i < plan.inputs.length; i++) {
    const coin = plan.inputs[i]!;
    const pubkey = publicKeyAt(
      keys.account.accountXpub,
      coin.branch,
      coin.index,
    );
    const scriptCode = payments.p2pkh({ pubkey }).output!;
    const digest = bitcoinControl.hashForWitnessV0(
      i,
      scriptCode,
      BigInt(coin.value),
      Transaction.SIGHASH_ALL,
    );
    bitcoinControl.setWitness(i, [
      script.signature.encode(
        keys.signDigest(coin.branch, coin.index, digest).signature,
        1,
      ),
      pubkey,
    ]);
  }
  if (
    bitcoinControl.getId() !== signed.txid ||
    stripped.getId() !== signed.txid
  )
    throw Error("Control transaction mismatch");
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        purpose: "Public fixture; isolated regtest only; no RPC performed",
        implementation: fixture.implementation,
        plan,
        ...signed,
        changedOutputHex: changedOutput.toHex(),
        strippedUnifiedHex: stripped.toHex(),
        bitcoinControlHex: bitcoinControl.toHex(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} finally {
  keys.destroy();
}
