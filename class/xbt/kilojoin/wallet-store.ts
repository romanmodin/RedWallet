/** Durable round reservation adapter for XBT wallets. Contains no private keys. */
import { Journal, JournalStore, validateJournal } from './round';
export interface ReservationWallet {
  getID(): string;
  _kilojoinJournals?: Record<string, Journal>;
}
const pending = new WeakSet<ReservationWallet>();
export function reservedCoins(wallet: ReservationWallet): Set<string> {
  if (pending.has(wallet)) throw new Error('CoinJoin reservation write pending');
  const records = wallet._kilojoinJournals;
  if (records === undefined) return new Set(); // Existing wallets predate this field.
  if (!records || typeof records !== 'object' || Array.isArray(records) || Object.keys(records).length > 100)
    throw new Error('Invalid CoinJoin wallet journal');
  const reserved = new Set<string>();
  for (const [id, value] of Object.entries(records)) {
    const j = validateJournal(value);
    if (j.walletId !== wallet.getID() || j.poolId !== id) throw new Error('CoinJoin journal identity mismatch');
    for (const coin of j.reserved) {
      if (reserved.has(coin)) throw new Error('Conflicting CoinJoin reservations');
      reserved.add(coin);
    }
  }
  return reserved;
}
export function assertUnreserved(wallet: ReservationWallet, inputs: { txid: string; vout: number }[]): void {
  const reserved = reservedCoins(wallet);
  if (inputs.some(i => reserved.has(`${i.txid}:${i.vout}`))) throw new Error('Input reserved by CoinJoin');
}
export class WalletJournalStore implements JournalStore {
  constructor(
    private readonly wallet: ReservationWallet,
    private readonly saveDurably: () => Promise<void>,
  ) {
    if (!wallet.getID()) throw new Error('Missing wallet identity');
  }

  async save(value: Journal): Promise<void> {
    const next = validateJournal(value);
    if (next.walletId !== this.wallet.getID()) throw new Error('Wrong journal wallet');
    reservedCoins(this.wallet); // Validate existing records and reject concurrent stores.
    const before = this.wallet._kilojoinJournals;
    const previous = before?.[next.poolId];
    if (!previous && next.phase !== 'joined') throw new Error('New round must start joined');
    // Only a fully cancelled unsigned attempt may be replaced. New identities
    // also reject late callbacks from the old attempt, even with equal deadlines.
    const restarting =
      previous?.phase === 'aborted' && next.phase === 'joined' && !!next.attemptId && next.attemptId !== previous.attemptId;
    if (restarting && [next.reviewedHex, next.reviewedId, next.commitment, next.myFee].some(field => field !== undefined))
      throw new Error('New attempt must not retain a prior review');
    if (previous && !restarting) {
      const allowed: Record<Journal['phase'], Journal['phase'][]> = {
        joined: ['joined', 'review', 'aborted'],
        review: ['review', 'approved', 'aborted'],
        approved: ['signed', 'aborted'],
        signed: ['uncertain', 'complete'],
        uncertain: ['uncertain', 'complete'],
        aborted: ['aborted'],
        complete: ['complete'],
      };
      if (
        next.attemptId !== previous.attemptId ||
        !allowed[previous.phase].includes(next.phase) ||
        next.deadline !== previous.deadline ||
        (next.reserved.length && JSON.stringify(next.reserved) !== JSON.stringify(previous.reserved)) ||
        (['approved', 'signed', 'uncertain', 'complete'].includes(next.phase) && next.commitment !== previous.commitment)
      )
        throw new Error('Invalid persisted round transition');
    }
    const records = { ...before, [next.poolId]: next };
    this.wallet._kilojoinJournals = records;
    try {
      reservedCoins(this.wallet);
    } catch (error) {
      this.wallet._kilojoinJournals = before;
      throw error;
    }
    pending.add(this.wallet);
    try {
      // This callback MUST reject on persistence errors. Do not pass a UI save helper
      // that catches errors or returns before the durable write finishes.
      await this.saveDurably();
    } catch (error) {
      this.wallet._kilojoinJournals = before;
      throw error;
    } finally {
      pending.delete(this.wallet);
    }
  }
}
