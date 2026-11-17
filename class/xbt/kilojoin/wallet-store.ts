import { address } from 'bitcoinjs-lib';
/** Durable round reservation adapter for XBT wallets. Contains no private keys. */
import { RoundJournal, holdsCoins, validateRound } from '../../joinblaket/round';
import { Journal, JournalStore, validateJournal } from './round';
export interface ReservationWallet {
  getID(): string;
  _kilojoinJournals?: Record<string, Journal>;
  _joinblaketJournals?: Record<string, RoundJournal>;
  _joinblaketRetiredAttempts?: Record<string, string>;
}
const pending = new WeakSet<ReservationWallet>();
export function reservedCoins(wallet: ReservationWallet): Set<string> {
  if (pending.has(wallet)) throw new Error('CoinJoin reservation write pending');
  const records = wallet._kilojoinJournals === undefined ? {} : wallet._kilojoinJournals;
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
  const payments = wallet._joinblaketJournals;
  if (payments !== undefined) {
    if (!payments || typeof payments !== 'object' || Array.isArray(payments) || Object.keys(payments).length > 100)
      throw new Error('Invalid JoinBlaket wallet journal');
    for (const [id, value] of Object.entries(payments)) {
      const j = validateRound(value);
      if (j.walletId !== wallet.getID() || j.attemptId !== id) throw new Error('JoinBlaket journal identity mismatch');
      if (!holdsCoins(j.phase)) continue;
      for (const coin of j.reserved) {
        if (reserved.has(coin)) throw new Error('Conflicting CoinJoin reservations');
        reserved.add(coin);
      }
    }
  }
  const retired = wallet._joinblaketRetiredAttempts;
  if (retired !== undefined) {
    if (!retired || typeof retired !== 'object' || Array.isArray(retired) || Object.keys(retired).length > 100000)
      throw new Error('Invalid JoinBlaket retired history');
    for (const [id, script] of Object.entries(retired)) {
      if (!/^[0-9a-f]{64}$/.test(id) || typeof script !== 'string' || !/^0014[0-9a-f]{40}$/.test(script) || payments?.[id])
        throw new Error('Invalid JoinBlaket retired attempt');
    }
  }
  return reserved;
}
/** Never reuse a change script previously disclosed for a JoinBlaket attempt. */
export function heldJoinBlaketChangeScripts(wallet: ReservationWallet): Set<string> {
  reservedCoins(wallet); // Includes identity/corruption checks and pending-write exclusion.
  return new Set([
    ...Object.values(wallet._joinblaketJournals ?? {}).map(j => j.changeScript),
    ...Object.values(wallet._joinblaketRetiredAttempts ?? {}),
  ]);
}
export function assertJoinBlaketChangeUnreserved(wallet: ReservationWallet, changeAddress: string): void {
  const held = heldJoinBlaketChangeScripts(wallet);
  if (held.size && held.has(Buffer.from(address.toOutputScript(changeAddress)).toString('hex')))
    throw new Error('Change address reserved by JoinBlaket');
}
/** Both protocols share the same write lock; normal sends fail closed while it is held. */
export async function persistReservationChange(
  wallet: ReservationWallet,
  apply: () => void,
  rollback: () => void,
  saveDurably: () => Promise<void>,
): Promise<void> {
  reservedCoins(wallet);
  try {
    apply();
    reservedCoins(wallet);
  } catch (error) {
    rollback();
    throw error;
  }
  pending.add(wallet);
  try {
    await saveDurably();
  } catch (error) {
    rollback();
    throw error;
  } finally {
    pending.delete(wallet);
  }
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
    await persistReservationChange(
      this.wallet,
      () => {
        this.wallet._kilojoinJournals = { ...before, [next.poolId]: next };
      },
      () => {
        this.wallet._kilojoinJournals = before;
      },
      this.saveDurably,
    );
  }
}
