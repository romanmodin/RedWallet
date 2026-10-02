/** Public discovery hints only. Never authorizes spending or stores key material. */
import type { PublicHistoryRow } from "./account-reader";
import { publicStorageKey } from "./public-wallet-storage";

export interface ScanCheckpoint {
  startedAt: number;
  gap: number;
  cap: number;
  history: [string, PublicHistoryRow[]][];
}
export function loadScanCheckpoint(xpub: string): ScanCheckpoint | null {
  try {
    const raw = localStorage.getItem(publicStorageKey(xpub, "partial"));
    if (!raw || raw.length > 2000000) return null;
    const data = JSON.parse(raw);
    if (
      !Number.isSafeInteger(data.startedAt) ||
      data.startedAt < 1 ||
      data.startedAt > Date.now() ||
      ![20, 100].includes(data.gap) ||
      ![1000, 2000].includes(data.cap) ||
      !Array.isArray(data.history) ||
      data.history.length > 4000
    )
      return null;
    const seen = new Set<string>();
    const history: ScanCheckpoint["history"] = data.history.map(
      (item: unknown) => {
        if (!Array.isArray(item) || item.length !== 2)
          throw Error("Invalid checkpoint");
        const [address, rows] = item;
        if (
          typeof address !== "string" ||
          !/^bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(address) ||
          seen.has(address) ||
          !Array.isArray(rows) ||
          rows.length > 1000
        )
          throw Error("Invalid checkpoint history");
        seen.add(address);
        const txids = new Set<string>();
        return [
          address,
          rows.map((row) => {
            if (
              typeof row.txid !== "string" ||
              !/^[0-9a-f]{64}$/.test(row.txid) ||
              typeof row.height !== "string" ||
              !/^-?\d{1,16}$/.test(row.height) ||
              txids.has(row.txid)
            )
              throw Error("Invalid checkpoint transaction");
            const height = BigInt(row.height);
            if (height < -1n || height > BigInt(Number.MAX_SAFE_INTEGER))
              throw Error("Invalid height");
            txids.add(row.txid);
            return { txid: row.txid, height };
          }),
        ];
      },
    );
    return { startedAt: data.startedAt, gap: data.gap, cap: data.cap, history };
  } catch {
    return null;
  }
}
export function saveScanCheckpoint(xpub: string, value: ScanCheckpoint) {
  const raw = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  if (raw.length > 2000000) throw Error("Scan checkpoint is too large to save");
  const key = publicStorageKey(xpub, "partial");
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw)
    throw Error("Scan checkpoint could not be saved");
}
export function clearScanCheckpoint(xpub: string) {
  localStorage.removeItem(publicStorageKey(xpub, "partial"));
}
