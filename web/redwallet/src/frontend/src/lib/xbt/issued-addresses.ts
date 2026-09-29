/** Public-only receive/change high-water marks. Never stores an address or key. */
import { sha256 } from "@noble/hashes/sha2";
import { publicAddress } from "./key-material";

export interface AddressIndexStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type AddressMutex = <T>(
  name: string,
  action: () => Promise<T>,
) => Promise<T>;
const MAX_INDEX = 1899; // Leaves room for the largest supported gap inside cap 2000.

/** No unlocked fallback: missing Web Locks means address rotation is unavailable. */
export const browserAddressMutex: AddressMutex = async (name, action) => {
  if (!navigator.locks)
    return Promise.reject(
      Error("This browser cannot safely reserve addresses across tabs"),
    );
  return await navigator.locks.request(name, { mode: "exclusive" }, action);
};

export class IssuedAddresses {
  readonly #key: string;
  constructor(
    readonly accountXpub: string,
    private readonly storage: AddressIndexStorage,
    private readonly mutex: AddressMutex = browserAddressMutex,
  ) {
    // Validate account scope before accepting any persisted bounds.
    publicAddress(accountXpub, 0, 0);
    const id = Array.from(sha256(new TextEncoder().encode(accountXpub)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    this.#key = `redwallet.issued.v1.${id}`;
  }

  /** Public bounds are untrusted; discovery always starts at zero on both branches. */
  read(): readonly [number, number] {
    const raw = this.storage.getItem(this.#key);
    // Address zero is already persisted in the authenticated vault envelope.
    if (raw === null) return [0, -1];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error("Saved address indices are damaged; recovery scan required");
    }
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some(
        (n, branch) =>
          !Number.isInteger(n) || n < (branch === 0 ? 0 : -1) || n > MAX_INDEX,
      )
    ) {
      throw Error(
        "Saved address indices are outside supported recovery bounds",
      );
    }
    return [value[0], value[1]];
  }

  /** Reserve durably before returning an address for display or transaction change. */
  reserve(branch: 0 | 1, minimumIndex: number, signal?: AbortSignal) {
    if (
      (branch !== 0 && branch !== 1) ||
      !Number.isInteger(minimumIndex) ||
      minimumIndex < 0 ||
      minimumIndex > MAX_INDEX
    )
      throw Error("Unsupported address index");
    return this.mutex(this.#key, async () => {
      if (signal?.aborted) throw Error("Address reservation cancelled");
      const issued = [...this.read()] as [number, number];
      const index = Math.max(issued[branch] + 1, minimumIndex);
      if (index > MAX_INDEX)
        throw Error("Address limit reached; use native wallet recovery");
      const address = publicAddress(this.accountXpub, branch, index);
      issued[branch] = index;
      const serialized = JSON.stringify(issued);
      this.storage.setItem(this.#key, serialized);
      if (this.storage.getItem(this.#key) !== serialized)
        throw Error("Could not verify the saved address reservation");
      // Cancellation can burn a public index, but can never reveal an unsaved one.
      if (signal?.aborted) throw Error("Address reservation cancelled");
      return Object.freeze({ branch, index, address });
    });
  }
}
