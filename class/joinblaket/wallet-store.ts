import { heldJoinBlaketChangeScripts, persistReservationChange, reservedCoins, ReservationWallet } from '../xbt/kilojoin/wallet-store';
import { Phase, RoundJournal, RoundPersistence, validateRound, holdsCoins } from './round';

export class JoinBlaketWalletStore implements RoundPersistence {
  private readonly wallet: ReservationWallet;
  private readonly saveDurably: () => Promise<void>;
  constructor(wallet: ReservationWallet, saveDurably: () => Promise<void>) {
    this.wallet = wallet;
    this.saveDurably = saveDurably;
  }

  async save(value: RoundJournal): Promise<void> {
    const next = validateRound(value);
    if (next.walletId !== this.wallet.getID()) throw new Error('Wrong JoinBlaket journal wallet');
    reservedCoins(this.wallet);
    const before = this.wallet._joinblaketJournals;
    const retiredBefore = this.wallet._joinblaketRetiredAttempts;
    const old = before?.[next.attemptId];
    if (retiredBefore?.[next.attemptId]) throw new Error('Retired JoinBlaket attempt cannot be reused');
    if (!old && next.phase !== 'preparing') throw new Error('New JoinBlaket round must start preparing');
    if (!old && Object.values(before ?? {}).some(j => holdsCoins(j.phase))) throw new Error('JoinBlaket payment already active');
    if (!old && reservedCoins(this.wallet).size) throw new Error('Conflicting CoinJoin reservations: another round is active');
    if (old) {
      const transitions: Record<Phase, readonly Phase[]> = {
        preparing: ['review', 'cancelled'],
        review: ['review', 'approved', 'cancelled'],
        approved: ['signing', 'cancelled'],
        signing: ['uncertain', 'confirmed'],
        uncertain: ['uncertain', 'confirmed'],
        cancelled: ['cancelled'],
        confirmed: ['confirmed'],
      };
      if (
        !transitions[old.phase].includes(next.phase) ||
        old.deadline !== next.deadline ||
        old.changeScript !== next.changeScript ||
        JSON.stringify(old.reserved) !== JSON.stringify(next.reserved) ||
        (old.phase !== 'preparing' && next.phase !== 'review' && old.commitment !== next.commitment)
      )
        throw new Error('Invalid persisted JoinBlaket transition');
    }
    const records = { ...before };
    const retired = { ...retiredBefore };
    if (!old) {
      if (heldJoinBlaketChangeScripts(this.wallet).has(next.changeScript))
        throw new Error('JoinBlaket change script was already disclosed');
      // Keep active/signed journals in full. Finished attempts need only their
      // identity tombstone and change script, so repeated cancellations cannot
      // exhaust the 100 full-journal bound or permit late callbacks/address reuse.
      for (const [id, journal] of Object.entries(records)) {
        if (!holdsCoins(journal.phase)) {
          retired[id] = journal.changeScript;
          delete records[id];
        }
      }
      if (Object.keys(retired).length >= 100000) throw new Error('JoinBlaket retired history is full');
    }
    records[next.attemptId] = next;
    await persistReservationChange(
      this.wallet,
      () => {
        this.wallet._joinblaketJournals = records;
        this.wallet._joinblaketRetiredAttempts = retired;
      },
      () => {
        this.wallet._joinblaketJournals = before;
        this.wallet._joinblaketRetiredAttempts = retiredBefore;
      },
      this.saveDurably,
    );
  }
}
