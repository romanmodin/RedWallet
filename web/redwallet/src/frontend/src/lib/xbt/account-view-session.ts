import type { BridgeActor } from "@/services/bridgeService";
import { PROVIDER_EVENT } from "@/services/networkGeneration";
import { AccountReader, type AccountSnapshot } from "./account-reader";
import type { IssuedAddresses } from "./issued-addresses";
/** Same-tab public scan state. Never stores keys, controllers, passwords or reviews. */
import {
  clearPublicSnapshots,
  loadPublicSnapshot,
  publicStorageKey,
  savePublicSnapshot,
} from "./public-wallet-storage";
import {
  type ScanCheckpoint,
  clearScanCheckpoint,
  loadScanCheckpoint,
  saveScanCheckpoint,
} from "./scan-checkpoint";

export interface AccountViewSession {
  reader: AccountReader | null;
  busy: boolean;
  error: string;
  warning: string;
  revision: number;
  listeners: Set<() => void>;
  stop: (() => void) | null;
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
    if (accounts.size >= 100) {
      const oldest = accounts.keys().next().value!;
      accounts.get(oldest)?.stop?.();
      accounts.delete(oldest);
    }
    const checkpoint = loadScanCheckpoint(accountXpub);
    session = {
      busy: false,
      error: "",
      warning: "",
      revision: 0,
      listeners: new Set(),
      stop: null,
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
  for (const stop of [...activeScans]) stop();
  try {
    if (!preserveSavedSnapshots) clearPublicSnapshots();
  } catch {
    /* unavailable storage */
  }
  sessions = new WeakMap();
}

export function clearAccountSnapshot(actor: BridgeActor, accountXpub: string) {
  sessions.get(actor)?.get(accountXpub)?.stop?.();
  sessions.get(actor)?.delete(accountXpub);
  localStorage.removeItem(publicStorageKey(accountXpub, "scan"));
}

export const ACCOUNT_SCAN_EVENT = "redwallet:public-scan-completed";
const activeScans = new Set<() => void>();
export function notifyAccountSession(session: AccountViewSession) {
  session.revision++;
  for (const listener of session.listeners) listener();
}

/** A public-only job, independent of the page and vault controller. No secret
 * references survive navigation. Retries are read-only and limited to one per
 * background/return cycle; explicit pause and provider invalidation cancel them. */
export function startAccountScan(
  session: AccountViewSession,
  actor: BridgeActor,
  xpub: string,
  addressBook: IssuedAddresses,
  fresh: boolean,
) {
  if (session.busy) return;
  // One active scan in this tab avoids multiplying the shared provider quota.
  for (const stop of [...activeScans]) stop();
  session.stop?.();
  // Rebuild from the public checkpoint so a resumed reader never keeps
  // the cancelled job's checkpoint callback or AbortSignal.
  session.reader = null;
  let stopped = false;
  let backgrounded = document.visibilityState !== "visible";
  let returned = false;
  let retryable = false;
  let controller: AbortController | null = null;
  const cleanup = () => {
    activeScans.delete(stop);
    window.removeEventListener(PROVIDER_EVENT, stop);
    window.removeEventListener("storage", storage);
    window.removeEventListener("pageshow", visible);
    window.removeEventListener("pagehide", hidden);
    document.removeEventListener("visibilitychange", visibility);
    if (session.stop === stop) session.stop = null;
  };
  const stop = () => {
    stopped = true;
    controller?.abort();
    cleanup();
    if (!session.busy) notifyAccountSession(session);
  };
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("redwallet.vault.v1."))
      stop();
  };
  const visible = () => {
    if (document.visibilityState !== "visible" || !backgrounded || stopped)
      return;
    returned = true;
    if (!session.busy && retryable) void run();
  };
  const hidden = () => {
    backgrounded = true;
    returned = false;
  };
  const visibility = () => {
    if (document.visibilityState !== "visible") {
      backgrounded = true;
      returned = false;
    } else visible();
  };
  session.stop = stop;
  activeScans.add(stop);
  window.addEventListener(PROVIDER_EVENT, stop);
  window.addEventListener("storage", storage);
  window.addEventListener("pageshow", visible);
  window.addEventListener("pagehide", hidden);
  document.addEventListener("visibilitychange", visibility);
  if (fresh) {
    session.reader = null;
    session.checkpoint = null;
    try {
      clearScanCheckpoint(xpub);
    } catch {
      session.warning = "This browser could not clear the saved scan.";
    }
  }
  async function run() {
    if (stopped || session.busy) return;
    // Consume the return retry before starting it, preventing retry loops.
    if (retryable) {
      backgrounded = false;
      returned = false;
      session.reader = null;
    }
    retryable = false;
    session.busy = true;
    session.error = "";
    controller = new AbortController();
    const abort = controller;
    notifyAccountSession(session);
    try {
      if (!session.reader) {
        session.reader = new AccountReader(
          xpub,
          actor,
          {
            gapLimit: session.gap,
            maxAddressesPerBranch: session.cap,
            issuedThrough: addressBook.read(),
          },
          undefined,
          undefined,
          {
            checkpoint: session.checkpoint,
            onCheckpoint: (checkpoint) => {
              if (stopped || abort.signal.aborted) return;
              session.checkpoint = checkpoint;
              try {
                saveScanCheckpoint(xpub, checkpoint);
              } catch {
                session.warning =
                  "Scan progress could not be saved on this device. Keep this tab open to resume.";
              }
            },
          },
        );
        session.checked = session.checkpoint?.history.length ?? 0;
      }
      const result = await session.reader.scan(abort.signal, (value) => {
        if (!stopped && !abort.signal.aborted) {
          session.checked = value.checked;
          notifyAccountSession(session);
        }
      });
      if (stopped || abort.signal.aborted) return;
      session.snapshot = result;
      session.reader = null;
      try {
        savePublicSnapshot(xpub, result);
        window.dispatchEvent(new Event(ACCOUNT_SCAN_EVENT));
        clearScanCheckpoint(xpub);
        session.checkpoint = null;
      } catch {
        session.warning =
          "Scan completed, but this browser could not save it. Keep this tab open.";
      }
      cleanup();
    } catch (error) {
      session.error =
        error instanceof Error
          ? error.message
          : "Account discovery failed. No empty wallet was assumed.";
      retryable =
        !stopped &&
        /connection closed|timed out|still finishing|Account read failed/i.test(
          session.error,
        );
      if (!retryable || !backgrounded) cleanup();
    } finally {
      session.busy = false;
      controller = null;
      notifyAccountSession(session);
      if (retryable && backgrounded && returned && !stopped) void run();
    }
  }
  void run();
}
