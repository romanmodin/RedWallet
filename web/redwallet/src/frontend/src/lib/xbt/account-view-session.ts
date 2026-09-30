/** Same-tab public scan state. Never stores keys, controllers, passwords or reviews. */
import type { BridgeActor } from "@/services/bridgeService";
import type { AccountReader, AccountSnapshot } from "./account-reader";

export interface AccountViewSession {
  reader: AccountReader | null;
  snapshot: AccountSnapshot | null;
  checked: number;
  gap: number;
  cap: number;
  receive: { address: string; index: number } | null;
}
let sessions = new WeakMap<BridgeActor, Map<string, AccountViewSession>>();

/** Actor and authenticated account scope prevent cross-network/account reuse. */
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
    session = {
      reader: null,
      snapshot: null,
      checked: 0,
      gap: 20,
      cap: 1000,
      receive: null,
    };
    accounts.set(accountXpub, session);
  }
  return session;
}

export function clearAccountViewSessions() {
  sessions = new WeakMap();
}
