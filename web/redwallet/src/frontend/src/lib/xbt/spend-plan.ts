/** Offline, P2WPKH-only transaction review/signing. No network or broadcast. */
import { sha256 } from "@noble/hashes/sha2";
import { address, networks, Psbt, Transaction } from "bitcoinjs-lib";
import { Buffer } from "buffer";
import {
  publicAddress,
  publicKeyAt,
  XbtKeySession,
  xbtEcc,
} from "./key-material";
import {
  finalizeUnifiedP2wpkhInput,
  signUnifiedP2wpkhInput,
} from "./unified-psbt";

const MAX_MONEY = 2_100_000_000_000_000n;
const DUST = 294n;
const MAX_FEE = 1_000_000n;
export interface CandidateCoin {
  txid: string;
  vout: number;
  value: string;
  height: number;
  branch: 0 | 1;
  index: number;
  parentHex: string;
}
export interface SpendPlan {
  accountXpub: string;
  destination: string;
  amount: string;
  fee: string;
  feeRate: number;
  change: string;
  changeIndex: number;
  tipHeight: number;
  inputs: CandidateCoin[];
}
export function parseXbtAmount(text: string): bigint {
  if (
    typeof text !== "string" ||
    !/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,8})?$/.test(text)
  )
    throw Error("Enter an exact XBT amount with at most 8 decimals");
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
  if (amount <= 0n || amount > MAX_MONEY)
    throw Error("Amount outside monetary range");
  return amount;
}
function satoshis(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value))
    throw Error("Invalid integer satoshis");
  const result = BigInt(value);
  if (result > MAX_MONEY) throw Error("Amount outside monetary range");
  return result;
}
function p2wpkh(destination: string): Uint8Array {
  if (
    typeof destination !== "string" ||
    destination !== destination.toLowerCase()
  )
    throw Error("Use a lowercase native SegWit XBT address");
  const output = address.toOutputScript(destination, networks.bitcoin);
  if (output.length !== 22 || output[0] !== 0 || output[1] !== 20)
    throw Error("Only native P2WPKH destinations are supported");
  return output;
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}
/** Verifies txid/output/value/script/ownership against full raw parent bytes. */
export function verifyCoin(
  coin: CandidateCoin,
  accountXpub: string,
  tipHeight: number,
): bigint {
  if (
    !Number.isSafeInteger(tipHeight) ||
    tipHeight <= 0 ||
    !Number.isSafeInteger(coin.height) ||
    coin.height <= 0 ||
    coin.height > tipHeight
  )
    throw Error("Confirmed height required");
  if (
    !/^[0-9a-f]{64}$/.test(coin.txid) ||
    !Number.isSafeInteger(coin.vout) ||
    coin.vout < 0 ||
    coin.vout > 0xffffffff
  )
    throw Error("Invalid outpoint");
  if (
    typeof coin.parentHex !== "string" ||
    coin.parentHex.length > 2_000_000 ||
    !/^(?:[0-9a-f]{2})+$/.test(coin.parentHex)
  )
    throw Error("Invalid raw parent");
  const parent = Transaction.fromHex(coin.parentHex);
  if (parent.getId() !== coin.txid)
    throw Error("Parent transaction ID mismatch");
  if (
    parent.ins.length === 1 &&
    parent.ins[0].index === 0xffffffff &&
    parent.ins[0].hash.every((v) => v === 0)
  )
    throw Error("Coinbase spending is not enabled");
  const output = parent.outs[coin.vout];
  const expected = p2wpkh(publicAddress(accountXpub, coin.branch, coin.index));
  const value = satoshis(coin.value);
  if (
    !output ||
    output.value !== value ||
    value <= 0n ||
    !equal(output.script, expected)
  )
    throw Error("Parent output or wallet ownership mismatch");
  return value;
}
function estimatedFee(inputs: number, outputs: number, rate: number): bigint {
  // Conservative maximum for native P2WPKH DER witnesses, <=100 inputs.
  return BigInt(11 + 69 * inputs + 31 * outputs) * BigInt(rate);
}
export function planSpend(args: {
  accountXpub: string;
  coins: CandidateCoin[];
  destination: string;
  amountXbt: string;
  feeRate: number;
  changeIndex: number;
  tipHeight: number;
}): SpendPlan {
  p2wpkh(args.destination);
  publicAddress(args.accountXpub, 1, args.changeIndex);
  const amount = parseXbtAmount(args.amountXbt);
  if (amount < DUST) throw Error("Destination amount is dust");
  if (
    !Number.isSafeInteger(args.feeRate) ||
    args.feeRate < 1 ||
    args.feeRate > 1000
  )
    throw Error("Invalid fee rate");
  if (
    !Array.isArray(args.coins) ||
    args.coins.length === 0 ||
    args.coins.length > 100
  )
    throw Error("Expected 1–100 confirmed coins");
  const seen = new Set<string>();
  const coins = args.coins
    .map((coin) => {
      const key = `${coin.txid}:${coin.vout}`;
      if (seen.has(key)) throw Error("Duplicate outpoint");
      seen.add(key);
      return {
        coin: { ...coin },
        value: verifyCoin(coin, args.accountXpub, args.tipHeight),
      };
    })
    .sort((a, b) =>
      a.value === b.value
        ? `${a.coin.txid}:${a.coin.vout}`.localeCompare(
            `${b.coin.txid}:${b.coin.vout}`,
          )
        : a.value > b.value
          ? -1
          : 1,
    );
  let total = 0n;
  const inputs: CandidateCoin[] = [];
  for (const { coin, value } of coins) {
    total += value;
    if (total > MAX_MONEY) throw Error("Input total exceeds monetary range");
    inputs.push(coin);
    const twoOutputFee = estimatedFee(inputs.length, 2, args.feeRate);
    const withChange = total - amount - twoOutputFee;
    let fee: bigint;
    let change: bigint;
    if (withChange >= DUST) {
      fee = twoOutputFee;
      change = withChange;
    } else if (total >= amount + estimatedFee(inputs.length, 1, args.feeRate)) {
      fee = total - amount;
      change = 0n;
    } else continue;
    if (fee > MAX_FEE) throw Error("Fee exceeds 0.01 XBT safety limit");
    return {
      accountXpub: args.accountXpub,
      destination: args.destination,
      amount: amount.toString(),
      fee: fee.toString(),
      feeRate: args.feeRate,
      change: change.toString(),
      changeIndex: args.changeIndex,
      tipHeight: args.tipHeight,
      inputs,
    };
  }
  throw Error("Insufficient confirmed funds");
}
/** The UI must retain this separately when the user approves the exact review. */
export function reviewDigest(plan: SpendPlan): string {
  const canonical = [
    plan.accountXpub,
    plan.destination,
    plan.amount,
    plan.fee,
    plan.feeRate,
    plan.change,
    plan.changeIndex,
    plan.tipHeight,
    plan.inputs.map((c) => [
      c.txid,
      c.vout,
      c.value,
      c.height,
      c.branch,
      c.index,
      c.parentHex,
    ]),
  ];
  return Buffer.from(
    sha256(new TextEncoder().encode(JSON.stringify(canonical))),
  ).toString("hex");
}
export function signReviewedPlan(
  plan: SpendPlan,
  approvedDigest: string,
  keys: XbtKeySession,
): { hex: string; txid: string; fee: string; virtualSize: number } {
  if (
    !/^[0-9a-f]{64}$/.test(approvedDigest) ||
    reviewDigest(plan) !== approvedDigest
  )
    throw Error("Transaction changed after review");
  if (keys.locked || keys.account.accountXpub !== plan.accountXpub)
    throw Error("Unlocked matching wallet required");
  const amount = satoshis(plan.amount);
  const amountXbt = `${amount / 100_000_000n}.${(amount % 100_000_000n).toString().padStart(8, "0")}`;
  const rebuilt = planSpend({
    accountXpub: plan.accountXpub,
    coins: plan.inputs,
    destination: plan.destination,
    amountXbt,
    feeRate: plan.feeRate,
    changeIndex: plan.changeIndex,
    tipHeight: plan.tipHeight,
  });
  if (reviewDigest(rebuilt) !== approvedDigest)
    throw Error("Reviewed plan is not canonical");
  const psbt = new Psbt({ network: networks.bitcoin });
  psbt.setVersion(2);
  psbt.setLocktime(0);
  for (const coin of plan.inputs) {
    psbt.addInput({
      hash: coin.txid,
      index: coin.vout,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: p2wpkh(
          publicAddress(plan.accountXpub, coin.branch, coin.index),
        ),
        value: satoshis(coin.value),
      },
    });
  }
  psbt.addOutput({ script: p2wpkh(plan.destination), value: amount });
  if (satoshis(plan.change) > 0n)
    psbt.addOutput({
      script: p2wpkh(publicAddress(plan.accountXpub, 1, plan.changeIndex)),
      value: satoshis(plan.change),
    });
  plan.inputs.forEach((coin, i) => {
    const publicKey = publicKeyAt(plan.accountXpub, coin.branch, coin.index);
    signUnifiedP2wpkhInput(psbt, i, {
      publicKey,
      sign: (digest) =>
        keys.signDigest(coin.branch, coin.index, digest).signature,
    });
    finalizeUnifiedP2wpkhInput(psbt, i, publicKey, (pub, digest, signature) =>
      xbtEcc.verify(digest, pub, signature),
    );
  });
  const transaction = psbt.extractTransaction();
  if (satoshis(plan.fee) < BigInt(transaction.virtualSize() * plan.feeRate))
    throw Error("Signed transaction exceeds reviewed fee size");
  return {
    hex: transaction.toHex(),
    txid: transaction.getId(),
    fee: plan.fee,
    virtualSize: transaction.virtualSize(),
  };
}
