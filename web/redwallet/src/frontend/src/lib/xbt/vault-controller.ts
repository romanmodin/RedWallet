/** Local encrypted persistence and explicit lock lifecycle; UI integration pending. */
import { type PublicXbtAccount, XbtKeySession } from "./key-material";
import { type VaultSecrets, openVault, parseVault, sealVault } from "./vault";

export interface VaultStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class VaultController {
  #session: XbtKeySession | null = null;
  #generation = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #expiresAt = 0;
  #monotonicDeadline = 0;
  constructor(
    readonly storageKey: string,
    private storage: VaultStorage,
    private cryptoApi: Crypto = globalThis.crypto,
  ) {
    if (!/^redwallet\.vault\.v1\.[a-zA-Z0-9-]{1,64}$/.test(storageKey))
      throw Error("Invalid vault storage key");
  }
  get locked(): boolean {
    // Browser timers may be delayed while a page is suspended. Enforce the
    // deadline at access time too; a backwards wall-clock adjustment must not
    // extend the lease, so either clock reaching its deadline expires it.
    if (this.#session &&
        (Date.now() >= this.#expiresAt || performance.now() >= this.#monotonicDeadline)) {
      this.lock();
    }
    return this.#session === null || this.#session.locked;
  }
  lock(): void {
    this.#generation++;
    this.#session?.destroy();
    this.#session = null;
    this.#expiresAt = 0;
    this.#monotonicDeadline = 0;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
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
    this.#expiresAt = Date.now() + 5 * 60_000;
    this.#monotonicDeadline = performance.now() + 5 * 60_000;
    this.#timer = setTimeout(() => this.lock(), 5 * 60_000);
    return this.#session.account;
  }
  /** Only synchronous reviewed signing is allowed; never return secret seed bytes. */
  withUnlocked<T>(operation: (keys: XbtKeySession) => T): T {
    if (this.locked || !this.#session) throw Error("Wallet is locked");
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
