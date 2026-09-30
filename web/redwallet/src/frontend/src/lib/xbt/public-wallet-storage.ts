/** Untrusted public observations and unsigned form text only. Never key material. */
import { sha256 } from "@noble/hashes/sha2";
import type { AccountSnapshot } from "./account-reader";
import { publicAddress } from "./key-material";
const PREFIX = "redwallet.public.xbt961640.v1.";
export function publicStorageKey(xpub: string, kind: string) {
  const id = Array.from(sha256(new TextEncoder().encode(xpub)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${PREFIX}${kind}.${id}`;
}
function integer(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error("Invalid saved account data");
}
/** Validates and re-derives every address. Balances remain display-only observations. */
export function validateSnapshot(
  xpub: string,
  value: AccountSnapshot,
): AccountSnapshot {
  integer(value.observedAt, 1, Number.MAX_SAFE_INTEGER);
  integer(value.height, 961640, Number.MAX_SAFE_INTEGER);
  if (
    typeof value.confirmed !== "bigint" ||
    value.confirmed < 0n ||
    value.confirmed > 2100000000000000n ||
    typeof value.unconfirmed !== "bigint" ||
    value.unconfirmed < -2100000000000000n ||
    value.unconfirmed > 2100000000000000n
  )
    throw Error("Invalid saved balance");
  if (!Array.isArray(value.branches) || value.branches.length !== 2)
    throw Error("Invalid saved branches");
  for (const [branch, data] of value.branches.entries()) {
    integer(data.scanned, 1, 2000);
    if (!Array.isArray(data.used) || data.used.length > 2000)
      throw Error("Invalid saved addresses");
    const seen = new Set<number>();
    for (const entry of [...data.used, data.next]) {
      integer(entry.index, 0, 1999);
      if (
        entry.branch !== branch ||
        entry.address !== publicAddress(xpub, entry.branch, entry.index) ||
        seen.has(entry.index)
      )
        throw Error("Account scan address mismatch");
      seen.add(entry.index);
    }
    if (data.used.some((entry) => entry.index >= data.next.index))
      throw Error("Invalid next address");
  }
  if (!Array.isArray(value.history) || value.history.length > 10000)
    throw Error("Invalid saved history");
  for (const row of value.history) {
    if (
      !/^[0-9a-f]{64}$/.test(row.txid) ||
      typeof row.height !== "bigint" ||
      row.height < -1n ||
      row.height > BigInt(value.height)
    )
      throw Error("Invalid saved history entry");
  }
  return value;
}
export function loadPublicSnapshot(xpub: string): AccountSnapshot | null {
  try {
    const raw = localStorage.getItem(publicStorageKey(xpub, "scan"));
    if (!raw || raw.length > 2000000) return null;
    const data = JSON.parse(raw);
    data.confirmed = BigInt(data.confirmed);
    data.unconfirmed = BigInt(data.unconfirmed);
    if (!Array.isArray(data.history)) return null;
    data.history = data.history.map(
      (row: { txid: string; height: string }) => ({
        ...row,
        height: BigInt(row.height),
      }),
    );
    return validateSnapshot(xpub, data);
  } catch {
    return null;
  }
}
export function savePublicSnapshot(xpub: string, snapshot: AccountSnapshot) {
  validateSnapshot(xpub, snapshot);
  const raw = JSON.stringify(snapshot, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  if (raw.length > 2000000) throw Error("Scan is too large to save locally");
  const key = publicStorageKey(xpub, "scan");
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw)
    throw Error("Scan storage could not be verified");
}
export function clearPublicSnapshots() {
  for (const key of Object.keys(localStorage))
    if (key.startsWith(`${PREFIX}scan.`)) localStorage.removeItem(key);
}
export interface PaymentDraft {
  destination: string;
  amount: string;
  rate: string;
}
export function loadPaymentDraft(xpub: string): PaymentDraft {
  const empty = { destination: "", amount: "", rate: "1" };
  try {
    const raw = localStorage.getItem(publicStorageKey(xpub, "draft"));
    if (!raw || raw.length > 1024) return empty;
    const value = JSON.parse(raw);
    if (
      typeof value.destination !== "string" ||
      value.destination.length > 128 ||
      typeof value.amount !== "string" ||
      value.amount.length > 32 ||
      typeof value.rate !== "string" ||
      value.rate.length > 8
    )
      return empty;
    return {
      destination: value.destination,
      amount: value.amount,
      rate: value.rate,
    };
  } catch {
    return empty;
  }
}
export function savePaymentDraft(xpub: string, draft: PaymentDraft) {
  localStorage.setItem(publicStorageKey(xpub, "draft"), JSON.stringify(draft));
}
