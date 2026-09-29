/** Local encrypted persistence and explicit lock lifecycle; UI integration pending. */
import { type PublicXbtAccount, XbtKeySession } from "./key-material";
import { type VaultSecrets, openVault, parseVault, sealVault } from "./vault";

export interface VaultStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** Five-minute unlocked window enforced by both a wall clock and a monotonic clock. */
const UNLOCK_WINDOW_MS = 5 * 60_000;
export class VaultController {
  #session: XbtKeySession | null = null;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #wallDeadline = 0;
  #monotonicDeadline = 0;
  constructor(
    readonly storageKey: string,
    private storage: VaultStorage,
    private cryptoApi: Crypto = globalThis.crypto,
    private now: () => number = () => Date.now(),
    private monotonicNow: () => number = () => performance.now(),
  ) {
    if (!/^redwallet\.vault\.v1\.[a-zA-Z0-9-]{1,64}$/.test(storageKey))
      throw Error("Invalid vault storage key");
  }
  get locked(): boolean {
    if (this.#session === null || this.#session.locked) return true;
    if (this.#expired()) {
      this.lock();
      return true;
    }
    return false;
  }
  /** True when either deadline has passed; a backwards wall clock cannot extend the monotonic one. */
  #expired(): boolean {
    return (
      this.now() >= this.#wallDeadline ||
      this.monotonicNow() >= this.#monotonicDeadline
    );
  }
  lock(): void {
    this.#generation++;
    this.#session?.destroy();
    this.#session = null;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#wallDeadline = 0;
    this.#monotonicDeadline = 0;
  }
  /** Creation persists ciphertext only and never replaces an existing vault. */
  async create(
    secrets: VaultSecrets,
    password: string,
  ): Promise<PublicXbtAccount> {
    if (this.storage.getItem(this.storageKey) !== null)
      throw Error("Vault already exists");
    const generation = this.#generation;
    const envelope = await sealVault(secrets, password, this.cryptoApi);
    if (this.#generation !== generation)
      throw Error("Vault operation cancelled");
    if (this.storage.getItem(this.storageKey) !== null)
      throw Error("Vault already exists");
    const encoded = JSON.stringify(envelope);
    this.storage.setItem(this.storageKey, encoded);
    if (this.storage.getItem(this.storageKey) !== encoded)
      throw Error("Vault could not be saved; keep your recovery backup");
    return {
      profile: envelope.profile,
      accountXpub: envelope.accountXpub,
      firstAddress: envelope.firstAddress,
    };
  }
  async unlock(password: string): Promise<PublicXbtAccount> {
    this.lock();
    const generation = this.#generation;
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) throw Error("Vault not found");
    parseVault(raw);
    const secrets = await openVault(raw, password, this.cryptoApi);
    if (
      this.#generation !== generation ||
      this.storage.getItem(this.storageKey) !== raw
    )
      throw Error("Vault operation cancelled");
    this.#session = new XbtKeySession(secrets.mnemonic, secrets.passphrase);
    this.#wallDeadline = this.now() + UNLOCK_WINDOW_MS;
    this.#monotonicDeadline = this.monotonicNow() + UNLOCK_WINDOW_MS;
    this.#timer = setTimeout(() => this.lock(), UNLOCK_WINDOW_MS);
    return this.#session.account;
  }
  /** Only synchronous reviewed signing is allowed; never return secret seed bytes. */
  withUnlocked<T>(operation: (keys: XbtKeySession) => T): T {
    if (!this.#session || this.#session.locked) throw Error("Wallet is locked");
    if (this.#expired()) {
      this.lock();
      throw Error("Wallet is locked");
    }
    const result = operation(this.#session);
    if (result instanceof Promise)
      throw Error("Asynchronous access to unlocked keys is not supported");
    return result;
  }
  /** Caller installs this once; backgrounding/navigation/storage replacement lock immediately. */
  attachLifecycle(page: Window, doc: Document): () => void {
    const hide = () => this.lock();
    const visibility = () => {
      if (doc.visibilityState !== "visible") this.lock();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === this.storageKey || event.key === null) this.lock();
    };
    page.addEventListener("pagehide", hide);
    page.addEventListener("storage", storage);
    doc.addEventListener("visibilitychange", visibility);
    return () => {
      page.removeEventListener("pagehide", hide);
      page.removeEventListener("storage", storage);
      doc.removeEventListener("visibilitychange", visibility);
      this.lock();
    };
  }
}
