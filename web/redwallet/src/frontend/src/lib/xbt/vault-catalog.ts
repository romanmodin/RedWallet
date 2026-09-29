/** Browser-local encrypted vault inventory. Never trusts locked public metadata. */
import type { VaultSecrets } from "./vault";
import { parseVault } from "./vault";
import { VaultController, type VaultStorage } from "./vault-controller";

export interface CatalogStorage extends VaultStorage {
  readonly length: number;
  key(index: number): string | null;
}
export interface SavedVault {
  id: string;
  name: string;
  damaged: boolean;
}
const PREFIX = "redwallet.vault.v1.";
const LABEL_PREFIX = "redwallet.vault-label.v1.";
const ID = /^[a-zA-Z0-9-]{1,64}$/;
function checkedId(id: string): string {
  if (!ID.test(id)) throw Error("Invalid wallet identifier");
  return id;
}
function label(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.length > 80 ||
    [...trimmed].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw Error("Use a wallet name of 1–80 characters");
  return trimmed;
}

export class VaultCatalog {
  #controllers = new Map<string, VaultController>();
  constructor(
    private readonly storage: CatalogStorage,
    private readonly cryptoApi: Crypto = globalThis.crypto,
  ) {}

  /** Enumerates ciphertext keys directly, so a failed label/list write cannot orphan a wallet. */
  list(): SavedVault[] {
    const entries: SavedVault[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const id = key.slice(PREFIX.length);
      if (!ID.test(id)) continue;
      if (entries.length >= 100)
        throw Error("Too many saved wallets to display safely");
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      let damaged = false;
      try {
        parseVault(raw);
      } catch {
        damaged = true;
      }
      const nameRaw = this.storage.getItem(LABEL_PREFIX + id);
      let name = `Encrypted wallet ${id.slice(0, 8)}`;
      if (nameRaw !== null) {
        try {
          name = label(nameRaw);
        } catch {
          /* Cosmetic labels are untrusted. */
        }
      }
      // Never return xpub/address/ciphertext from unauthenticated envelopes.
      entries.push({ id, name, damaged });
    }
    return entries.sort((a, b) => a.id.localeCompare(b.id));
  }

  controller(id: string): VaultController {
    checkedId(id);
    let controller = this.#controllers.get(id);
    if (!controller) {
      controller = new VaultController(
        PREFIX + id,
        this.storage,
        this.cryptoApi,
      );
      this.#controllers.set(id, controller);
    }
    return controller;
  }

  async create(
    name: string,
    secrets: VaultSecrets,
    password: string,
  ): Promise<{ id: string; labelSaved: boolean }> {
    const normalized = label(name);
    // Fail before encrypting if existing inventory cannot be read.
    if (this.list().length >= 100) throw Error("Saved wallet limit reached");
    const id = checkedId(this.cryptoApi.randomUUID());
    const controller = this.controller(id);
    await controller.create(secrets, password);
    let labelSaved = false;
    try {
      this.storage.setItem(LABEL_PREFIX + id, normalized);
      labelSaved = this.storage.getItem(LABEL_PREFIX + id) === normalized;
    } catch {
      /* Ciphertext remains discoverable directly by its own key. */
    }
    return { id, labelSaved };
  }

  lockAll(): void {
    for (const controller of this.#controllers.values()) controller.lock();
  }
}
