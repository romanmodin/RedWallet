// Compatible with Android/Kilowallet's joinblaket_commitments backup value.
// The adapter must resolve save() only after a durable write. No secret keys live here.
const HEX = /^[0-9a-f]{64}$/i;
const MAX_ENTRIES = 100_000;
function commitment(value: unknown): string {
  if (typeof value !== 'string' || !HEX.test(value)) throw new Error('Invalid PoDLE commitment');
  return value.toLowerCase();
}
function decode(text: string | null): Set<string> {
  if (text === null) return new Set();
  if (typeof text !== 'string' || text.length > 7_000_000) throw new Error('Invalid commitment store');
  const value = JSON.parse(text);
  if (
    !value ||
    !Array.isArray(value.used) ||
    value.used.length > MAX_ENTRIES ||
    !value.external ||
    typeof value.external !== 'object' ||
    Array.isArray(value.external) ||
    Object.keys(value.external).length
  ) {
    throw new Error('Invalid or unsupported commitment store');
  }
  return new Set(value.used.map(commitment));
}
function encode(used: Set<string>): string {
  if (used.size > MAX_ENTRIES) throw new Error('Commitment store is full');
  return JSON.stringify({ used: [...used], external: {} });
}
export interface CommitmentPersistence {
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}
// Exactly one instance per wallet/storage key. Persistence adapters must arbitrate
// other processes as well; an in-process queue alone is not a cross-process lock.
export class CommitmentStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly persistence: CommitmentPersistence;
  constructor(persistence: CommitmentPersistence) {
    this.persistence = persistence;
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }

  isUsed(hex: string): Promise<boolean> {
    const key = commitment(hex);
    return this.exclusive(async () => decode(await this.persistence.load()).has(key));
  }

  // Only the caller receiving true may reveal this commitment. A failed write
  // rejects; corrupt storage never becomes an empty set and permits reuse.
  consume(hex: string): Promise<boolean> {
    const key = commitment(hex);
    return this.exclusive(async () => {
      const used = decode(await this.persistence.load());
      if (used.has(key)) return false;
      used.add(key);
      await this.persistence.save(encode(used));
      return true;
    });
  }

  mergeBackup(text: string): Promise<void> {
    return this.exclusive(async () => {
      const incoming = decode(text);
      const used = decode(await this.persistence.load());
      for (const key of incoming) used.add(key);
      await this.persistence.save(encode(used));
    });
  }

  exportBackup(): Promise<string> {
    return this.exclusive(async () => encode(decode(await this.persistence.load())));
  }
}
