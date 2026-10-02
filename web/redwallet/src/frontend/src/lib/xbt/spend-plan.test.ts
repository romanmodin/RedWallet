import { Transaction, address, script } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import { XbtKeySession, publicAddress } from "./key-material";
import {
  type CandidateCoin,
  parseXbtAmount,
  planSpend,
  reviewDigest,
  signReviewedPlan,
  verifyCoin,
} from "./spend-plan";
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
function fixture() {
  const keys = new XbtKeySession(PHRASE);
  const parent = new Transaction();
  parent.addInput(new Uint8Array(32).fill(1), 0);
  parent.addOutput(address.toOutputScript(keys.account.firstAddress), 100_000n);
  const coin: CandidateCoin = {
    txid: parent.getId(),
    vout: 0,
    value: "100000",
    height: 900000,
    branch: 0,
    index: 0,
    parentHex: parent.toHex(),
  };
  const args = {
    accountXpub: keys.account.accountXpub,
    coins: [coin],
    destination: publicAddress(keys.account.accountXpub, 0, 1),
    amountXbt: "0.0005",
    feeRate: 2,
    changeIndex: 0,
    tipHeight: 974709,
  };
  return { keys, parent, coin, args };
}
describe("offline verified transaction planning", () => {
  it("parses exact integer satoshis and rejects ambiguous floating-point forms", () => {
    expect(parseXbtAmount("0.00000001")).toBe(1n);
    expect(parseXbtAmount("21000000")).toBe(2100000000000000n);
    for (const invalid of [
      "0",
      "-1",
      "1e-8",
      "1.000000001",
      "01",
      "1,000",
      "Infinity",
      "21000000.00000001",
      " 1",
    ])
      expect(() => parseXbtAmount(invalid)).toThrow();
  });
  it("checks the full parent and rejects substituted value, outpoint, script, index and height", () => {
    const { keys, coin, args } = fixture();
    expect(verifyCoin(coin, args.accountXpub, args.tipHeight)).toBe(100000n);
    for (const bad of [
      { ...coin, value: "100001" },
      { ...coin, vout: 1 },
      { ...coin, txid: "ab".repeat(32) },
      { ...coin, index: 1 },
      { ...coin, height: 0 },
      { ...coin, height: args.tipHeight + 1 },
      { ...coin, parentHex: `${coin.parentHex}00` },
    ])
      expect(() => verifyCoin(bad, args.accountXpub, args.tipHeight)).toThrow();
    keys.destroy();
  });
  it("accepts mature coinbase, rejects the one-block boundary and verifies its encoded height", () => {
    const { keys, parent, coin, args } = fixture();
    parent.version = 2;
    parent.ins[0].hash.fill(0);
    parent.ins[0].index = 0xffffffff;
    parent.ins[0].script = script.compile([script.number.encode(973440)]);
    const reward = {
      ...coin,
      height: 973440,
      parentHex: parent.toHex(),
      txid: parent.getId(),
    };
    expect(() => verifyCoin(reward, args.accountXpub, 979918)).toThrow(
      /1 more blocks/,
    );
    expect(verifyCoin(reward, args.accountXpub, 979919)).toBe(100000n);
    expect(() =>
      verifyCoin({ ...reward, height: 960000 }, args.accountXpub, 979919),
    ).toThrow(/height does not match/);
    const plan = planSpend({ ...args, coins: [reward], tipHeight: 979919 });
    expect(
      Transaction.fromHex(
        signReviewedPlan(plan, reviewDigest(plan), keys).hex,
      ).ins[0].witness[0].at(-1),
    ).toBe(0x21);
    const youngerTip = { ...plan, tipHeight: 979918 };
    expect(() =>
      signReviewedPlan(youngerTip, reviewDigest(youngerTip), keys),
    ).toThrow(/immature/);
    keys.destroy();
  });
  it("rejects duplicate inputs, dust, insufficient funds and unbounded fees", () => {
    const { keys, args, coin } = fixture();
    expect(() => planSpend({ ...args, coins: [coin, coin] })).toThrow(
      "Duplicate",
    );
    expect(() => planSpend({ ...args, amountXbt: "0.00000001" })).toThrow(
      "dust",
    );
    expect(() => planSpend({ ...args, amountXbt: "0.001" })).toThrow(
      "Insufficient",
    );
    expect(() => planSpend({ ...args, feeRate: 1001 })).toThrow("fee rate");
    keys.destroy();
  });
  it("rejects BTC formats outside the explicit P2WPKH profile", () => {
    const { keys, args } = fixture();
    expect(() =>
      planSpend({ ...args, destination: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }),
    ).toThrow();
    keys.destroy();
  });
  it("creates exact change, signs every input with 0x21, and conserves satoshis", () => {
    const { keys, args } = fixture();
    const plan = planSpend(args);
    expect(plan.fee).toBe("284");
    expect(plan.change).toBe("49716");
    const signed = signReviewedPlan(plan, reviewDigest(plan), keys);
    const tx = Transaction.fromHex(signed.hex);
    expect(tx.getId()).toBe(signed.txid);
    expect(tx.ins[0].witness[0].at(-1)).toBe(0x21);
    expect(tx.outs.reduce((n, o) => n + o.value, 0n) + BigInt(signed.fee)).toBe(
      100000n,
    );
    expect(BigInt(signed.fee)).toBeGreaterThanOrEqual(
      BigInt(signed.virtualSize * args.feeRate),
    );
    keys.destroy();
  });
  it("adds sub-dust change to reviewed fee without creating a dust output", () => {
    const { keys, args } = fixture();
    const plan = planSpend({ ...args, amountXbt: "0.000995" });
    expect(plan.change).toBe("0");
    expect(plan.fee).toBe("500");
    expect(
      Transaction.fromHex(signReviewedPlan(plan, reviewDigest(plan), keys).hex)
        .outs,
    ).toHaveLength(1);
    keys.destroy();
  });
  it("refuses modified review, non-canonical fees and locked or different keys", () => {
    const { keys, args } = fixture();
    const plan = planSpend(args);
    const digest = reviewDigest(plan);
    expect(() =>
      signReviewedPlan({ ...plan, amount: "50001" }, digest, keys),
    ).toThrow("changed");
    const malicious = { ...plan, fee: "90000", change: "0" };
    expect(() =>
      signReviewedPlan(malicious, reviewDigest(malicious), keys),
    ).toThrow("canonical");
    const other = new XbtKeySession(PHRASE, "different account");
    expect(() => signReviewedPlan(plan, digest, other)).toThrow("matching");
    other.destroy();
    keys.destroy();
    expect(() => signReviewedPlan(plan, digest, keys)).toThrow("matching");
  });
});
