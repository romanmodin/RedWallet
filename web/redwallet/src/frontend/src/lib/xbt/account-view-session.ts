import type { BridgeActor } from "@/services/bridgeService";
import type { AccountReader, AccountSnapshot } from "./account-reader";
/** Same-tab public scan state. Never stores keys, controllers, passwords or reviews. */
import {
  clearPublicSnapshots,
  loadPublicSnapshot,
  publicStorageKey,
} from "./public-wallet-storage";
import { type ScanCheckpoint, loadScanCheckpoint } from "./scan-checkpoint";

export interface AccountViewSession {
  reader: AccountReader | null;
  checkpoint: ScanCheckpoint | null;
  snapshot: AccountSnapshot | null;
  checked: number;
  gap: number;
  cap: number;
  receive: { address: string; index: number } | null;
}
let sessions = new WeakMap<BridgeActor, Map<string, AccountViewSession>>();

/** Live readers are actor-scoped; durable XBT observations are historical account hints. */
export function accountViewSession(actor: BridgeActor, accountXpub: string) {
  let accounts = sessions.get(actor);
  if (!accounts) {
    accounts = new Map();
    sessions.set(actor, accounts);
  }
  let session = accounts.get(accountXpub);
  if (!session) {
    // Same bound as the vault catalog; this cache must not grow without limit.
    if (accounts.size >= 100) accounts.delete(accounts.keys().next().value!);
    const checkpoint = loadScanCheckpoint(accountXpub);
    session = {
      checkpoint,
      reader: null,
      snapshot: loadPublicSnapshot(accountXpub),
      checked: checkpoint?.history.length ?? 0,
      gap: checkpoint?.gap ?? 20,
      cap: checkpoint?.cap ?? 1000,
      receive: null,
    };
    accounts.set(accountXpub, session);
  }
  if (session.snapshot && !session.checked)
    session.checked = session.snapshot.branches.reduce(
      (sum, b) => sum + b.scanned,
      0,
    );
  return session;
}

export function clearAccountViewSessions(preserveSavedSnapshots = false) {
  try {
    if (!preserveSavedSnapshots) clearPublicSnapshots();
  } catch {
    /* unavailable storage */
  }
  sessions = new WeakMap();
}

export function clearAccountSnapshot(actor: BridgeActor, accountXpub: string) {
  sessions.get(actor)?.delete(accountXpub);
  localStorage.removeItem(publicStorageKey(accountXpub, "scan"));
}
