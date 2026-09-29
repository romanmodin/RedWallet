import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSignedWebTransaction } from "../src/transaction.js";

// Published seed and fake coins only. Web-signed transaction independently
// accepted/confirmed by isolated XBT Knots; replay tests live beside receipt.
const fixture = JSON.parse(readFileSync(new URL("../../../../test/regtest/xbt-web-signed-20260929.json", import.meta.url), "utf8"));
test("narrow structural parser matches the independently accepted web transaction ID", () => {
  assert.deepEqual(validateSignedWebTransaction(fixture.hex), { hex: fixture.hex, txid: fixture.txid });
});
test("ordinary BTC and stripped Unified signatures are rejected", () => {
  assert.throws(() => validateSignedWebTransaction(fixture.bitcoinControlHex));
  assert.throws(() => validateSignedWebTransaction(fixture.strippedUnifiedHex));
});
test("bounds, malformed encodings, truncation and trailing bytes fail closed", () => {
  for (const hex of [null, "", "AB", "00".repeat(100001), fixture.hex.slice(0, -2), fixture.hex + "00", "01000000" + fixture.hex.slice(8), fixture.hex.slice(0, -8) + "01000000"]) {
    assert.throws(() => validateSignedWebTransaction(hex));
  }
});
test("duplicate outpoints and noncanonical or oversized input counts are rejected", () => {
  const b = Buffer.from(fixture.hex, "hex");
  assert.equal(b[6], 2);
  const duplicate = Buffer.from(b); b.copy(duplicate, 48, 7, 43);
  assert.throws(() => validateSignedWebTransaction(duplicate.toString("hex")));
  for (const count of [0, 101, 253, 254, 255]) {
    const malformed = Buffer.from(b); malformed[6] = count;
    assert.throws(() => validateSignedWebTransaction(malformed.toString("hex")));
  }
});
test("parser does not pretend to validate signatures against altered outputs", () => {
  // Structural validation cannot prove signatures or input values. The live
  // XBT node rejected this negative control in the saved isolated-node test.
  assert.notEqual(validateSignedWebTransaction(fixture.changedOutputHex).txid, fixture.txid);
});
