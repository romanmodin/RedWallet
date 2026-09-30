/** Public signed bytes only. No seed/password persistence, and no network calls. */
import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha2";
import { Transaction, address, networks, script } from "bitcoinjs-lib";
import {
  type AddressIndexStorage,
  type AddressMutex,
  browserAddressMutex,
} from "./issued-addresses";
import { publicAddress, publicKeyAt, xbtEcc } from "./key-material";
import type { SpendPlan } from "./spend-plan";
import { unifiedSegwitV0SighashAll } from "./unified-sighash";

export interface PendingPayment {
  version: 1;
  accountXpub: string;
  hex: string;
  txid: string;
  inputs: { branch: 0 | 1; index: number; value: string }[];
  destination: string;
  amount: string;
  fee: string;
  change: string;
  changeIndex: number;
  state: "signed" | "unknown" | "acknowledged" | "confirmed";
}
const STATES = new Set(["signed", "unknown", "acknowledged", "confirmed"]);
const MAX_MONEY = 2_100_000_000_000_000n;
function sat(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value))
    throw Error("Invalid saved payment amount");
  const n = BigInt(value);
  if (n > MAX_MONEY) throw Error("Saved payment amount exceeds limit");
  return n;
}
function bytesEqual(a: Uint8Array, b: Uint8Array) {
  return Buffer.from(a).equals(Buffer.from(b));
}
function outputScript(a: string) {
  return address.toOutputScript(a, networks.bitcoin);
}
/** Reauthenticate untrusted local records with every original Unified signature.
 * The signed digest binds prevout values, input ownership and all output bytes;
 * persisted display fields are separately matched against that transaction.
 */
export function validatePendingPayment(
  raw: string,
  accountXpub: string,
): PendingPayment {
  if (raw.length > 65536) throw Error("Saved payment is too large");
  const p: PendingPayment = JSON.parse(raw);
  if (
    !p ||
    p.version !== 1 ||
    p.accountXpub !== accountXpub ||
    !STATES.has(p.state) ||
    typeof p.hex !== "string" ||
    p.hex.length > 32768 ||
    !/^(?:[0-9a-f]{2})+$/.test(p.hex)
  )
    throw Error("Invalid saved payment");
  publicAddress(accountXpub, 0, 0);
  const tx = Transaction.fromHex(p.hex);
  if (
    tx.toHex() !== p.hex ||
    tx.getId() !== p.txid ||
    tx.version !== 2 ||
    tx.locktime !== 0 ||
    tx.ins.length < 1 ||
    tx.ins.length > 100 ||
    !Array.isArray(p.inputs) ||
    p.inputs.length !== tx.ins.length
  )
    throw Error("Saved transaction does not match payment");
  const seen = new Set<string>();
  const spent = p.inputs.map((coin, index) => {
    const input = tx.ins[index];
    const key = `${Buffer.from(input.hash).toString("hex")}:${input.index}`;
    if (
      seen.has(key) ||
      input.hash.every((v) => v === 0) ||
      input.sequence !== 0xfffffffd ||
      input.script.length !== 0 ||
      input.witness.length !== 2
    )
      throw Error("Invalid saved payment input");
    seen.add(key);
    const pub = publicKeyAt(accountXpub, coin.branch, coin.index);
    if (!bytesEqual(input.witness[1], pub))
      throw Error("Saved payment input belongs to another key");
    const value = sat(coin.value);
    if (value === 0n) throw Error("Invalid saved input value");
    return {
      value,
      script: outputScript(publicAddress(accountXpub, coin.branch, coin.index)),
    };
  });
  for (let i = 0; i < tx.ins.length; i++) {
    const encoded = Buffer.from(tx.ins[i].witness[0]);
    if (encoded.length < 2 || encoded[encoded.length - 1] !== 0x21)
      throw Error("Saved payment lacks XBT replay protection");
    encoded[encoded.length - 1] = 1;
    const sig = script.signature.decode(encoded).signature;
    const scriptCode = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      Buffer.from(spent[i].script).subarray(2),
      Buffer.from([0x88, 0xac]),
    ]);
    const digest = unifiedSegwitV0SighashAll(tx, i, spent, scriptCode);
    if (!xbtEcc.verify(digest, tx.ins[i].witness[1], sig))
      throw Error("Saved payment signature is invalid");
  }
  const amount = sat(p.amount);
  const change = sat(p.change);
  const fee = sat(p.fee);
  if (
    typeof p.destination !== "string" ||
    p.destination !== p.destination.toLowerCase()
  )
    throw Error("Invalid saved destination");
  const destination = outputScript(p.destination);
  if (
    destination.length !== 22 ||
    destination[0] !== 0 ||
    destination[1] !== 20 ||
    amount < 294n ||
    fee > 1_000_000n ||
    fee < BigInt(tx.virtualSize())
  )
    throw Error("Saved payment exceeds limits");
  if (
    tx.outs.length !== (change > 0n ? 2 : 1) ||
    tx.outs[0].value !== amount ||
    !bytesEqual(tx.outs[0].script, destination)
  )
    throw Error("Saved destination or amount changed");
  const changeScript = outputScript(
    publicAddress(accountXpub, 1, p.changeIndex),
  );
  if (
    change > 0n &&
    (change < 294n ||
      tx.outs[1].value !== change ||
      !bytesEqual(tx.outs[1].script, changeScript))
  )
    throw Error("Saved change does not belong to this wallet");
  const total = spent.reduce((a, c) => a + c.value, 0n);
  if (total > MAX_MONEY || total !== amount + change + fee)
    throw Error("Saved fee does not match signed values");
  return Object.freeze({
    ...p,
    inputs: Object.freeze(p.inputs.map((c) => Object.freeze({ ...c }))),
  }) as unknown as PendingPayment;
}

/** One unresolved payment per account. A mutex covers signing and durable write.
 * Missing/corrupt storage always blocks submission. On disk, every signed payment
 * is potentially submitted: its untrusted state label NEVER permits new signing.
 */
export class PendingPayments {
  readonly key: string;
  constructor(
    readonly accountXpub: string,
    private storage: AddressIndexStorage & {
      removeItem?: (key: string) => void;
      readonly length?: number;
      key?: (index: number) => string | null;
    },
    private mutex: AddressMutex = browserAddressMutex,
  ) {
    publicAddress(accountXpub, 0, 0);
    this.key = `redwallet.payment.v1.${Buffer.from(sha256(new TextEncoder().encode(accountXpub))).toString("hex")}`;
  }
  read(): PendingPayment | null {
    const raw = this.storage.getItem(this.key);
    return raw === null ? null : validatePendingPayment(raw, this.accountXpub);
  }
  /** Read existing v1 archives without migration. Display only: local confirmation
   * labels are not fresh network evidence and never authorize a new spend.
   * One damaged archive must not hide other receipts or the pending payment.
   */
  readConfirmed(): { payments: PendingPayment[]; incomplete: boolean } {
    if (!this.storage.key || this.storage.length === undefined)
      throw Error("Payment history storage unavailable");
    const prefix = `${this.key}.confirmed.`;
    const payments: PendingPayment[] = [];
    let incomplete = this.storage.length > 10000;
    let examined = 0;
    for (let i = 0; i < Math.min(this.storage.length, 10000); i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      if (examined++ >= 100) {
        incomplete = true;
        continue;
      }
      try {
        const raw = this.storage.getItem(key);
        if (raw === null) throw Error("Missing archive");
        const payment = validatePendingPayment(raw, this.accountXpub);
        if (key !== `${prefix}${payment.txid}` || payment.state !== "confirmed")
          throw Error("Invalid archive");
        payments.push(payment);
      } catch {
        incomplete = true;
      }
    }
    return { payments, incomplete };
  }
  async signAndSave(
    plan: SpendPlan,
    sign: () => { hex: string; txid: string },
  ): Promise<PendingPayment> {
    return this.mutex(this.key, async () => {
      if (this.read())
        throw Error(
          "Resolve the existing signed payment before preparing another",
        );
      if (plan.accountXpub !== this.accountXpub)
        throw Error("Wrong payment account");
      const signed = sign();
      const payment: PendingPayment = {
        version: 1,
        accountXpub: this.accountXpub,
        ...signed,
        inputs: plan.inputs.map(({ branch, index, value }) => ({
          branch,
          index,
          value,
        })),
        destination: plan.destination,
        amount: plan.amount,
        fee: plan.fee,
        change: plan.change,
        changeIndex: plan.changeIndex,
        state: "signed",
      };
      return this.#save(payment);
    });
  }
  async mark(
    txid: string,
    state: PendingPayment["state"],
  ): Promise<PendingPayment> {
    return this.mutex(this.key, async () => {
      const current = this.read();
      if (!current || current.txid !== txid)
        throw Error("Saved payment changed");
      return this.#save({ ...current, state });
    });
  }
  /** Explicit user submission only. Persist uncertainty BEFORE the first network call. */
  async submit(
    send: (
      hex: string,
      txid: string,
    ) => Promise<{ txid: string; outcome: string }>,
  ): Promise<PendingPayment> {
    return this.mutex(this.key, async () => {
      const current = this.read();
      if (!current) throw Error("No saved payment to submit");
      this.#save({ ...current, state: "unknown" });
      let acknowledged = false;
      try {
        const result = await send(current.hex, current.txid);
        acknowledged =
          result.txid === current.txid && result.outcome === "acknowledged";
      } catch {
        /* The original bytes may already have reached the node. */
      }
      const stillSaved = this.read();
      if (!stillSaved || stillSaved.hex !== current.hex)
        throw Error("Saved payment changed; submission outcome is unknown");
      return this.#save({
        ...current,
        state: acknowledged ? "acknowledged" : "unknown",
      });
    });
  }
  /** The caller must freshly verify checkpoint + exact raw bytes + confirmed history.
   * An untrusted saved state label is never sufficient. Archive before clearing.
   */
  async archiveConfirmed(
    confirm: (payment: PendingPayment) => Promise<boolean>,
  ): Promise<void> {
    return this.mutex(this.key, async () => {
      if (!this.storage.removeItem)
        throw Error("Payment archive storage unavailable");
      const current = this.read();
      if (!current) throw Error("No payment to reconcile");
      if (!(await confirm(current)))
        throw Error(
          "Payment is not confirmed; the same signed transaction remains saved",
        );
      const stillSaved = this.read();
      if (!stillSaved || stillSaved.hex !== current.hex)
        throw Error("Saved payment changed during confirmation");
      const archiveKey = `${this.key}.confirmed.${current.txid}`;
      const raw = JSON.stringify({ ...current, state: "confirmed" });
      this.storage.setItem(archiveKey, raw);
      if (this.storage.getItem(archiveKey) !== raw)
        throw Error("Could not preserve confirmed payment");
      this.storage.removeItem(this.key);
      if (this.storage.getItem(this.key) !== null)
        throw Error("Could not finish payment archive");
    });
  }
  #save(payment: PendingPayment) {
    const raw = JSON.stringify(payment);
    const checked = validatePendingPayment(raw, this.accountXpub);
    this.storage.setItem(this.key, raw);
    if (this.storage.getItem(this.key) !== raw)
      throw Error(
        "Could not verify saved payment; retain the original transaction and check its status",
      );
    return checked;
  }
}
