/** Offline round lifecycle. No network, wallet key access, automatic signing or broadcasting.
 * A signed round stays reserved even on cancellation: peers can retain our signature.
 * The future wallet adapter must persist this journal before every external side effect.
 */
import { Transaction } from 'bitcoinjs-lib';
import { Plan, Review, outpoint, review } from './transaction';
import { utf8Hash } from './crypto';
export type Phase = 'joined' | 'review' | 'approved' | 'signed' | 'uncertain' | 'aborted' | 'complete';
export type Journal = {
  version: 1;
  walletId: string;
  poolId: string;
  phase: Phase;
  reserved: string[];
  deadline: number;
  reviewedHex?: string;
  reviewedId?: string;
  commitment?: string;
  myFee?: number;
};
export interface JournalStore {
  // Must be a durable atomic write; errors prevent the transition from succeeding.
  save(journal: Journal): Promise<void>;
}
const clone = (j: Journal): Journal => ({ ...j, reserved: [...j.reserved] });
/** Validate persisted data before it can influence spending or recovery. */
export function validateJournal(value: unknown): Journal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid round journal');
  const j = value as Journal;
  if (
    j.version !== 1 ||
    typeof j.walletId !== 'string' ||
    !j.walletId ||
    typeof j.poolId !== 'string' ||
    !/^[0-9a-f]{16,64}$/.test(j.poolId) ||
    !['joined', 'review', 'approved', 'signed', 'uncertain', 'aborted', 'complete'].includes(j.phase) ||
    !Number.isSafeInteger(j.deadline) ||
    j.deadline < 1 ||
    !Array.isArray(j.reserved) ||
    j.reserved.length > 10 ||
    new Set(j.reserved).size !== j.reserved.length ||
    j.reserved.some(s => typeof s !== 'string' || !/^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/.test(s) || Number(s.split(':')[1]) > 0xffffffff)
  )
    throw new Error('Invalid round journal');
  const terminal = ['aborted', 'complete'].includes(j.phase);
  if (terminal ? j.reserved.length !== 0 : j.reserved.length === 0) throw new Error('Invalid journal reservation');
  if (['review', 'approved', 'signed', 'uncertain', 'complete'].includes(j.phase)) {
    if (
      typeof j.reviewedHex !== 'string' ||
      j.reviewedHex.length > 200000 ||
      !/^(?:[0-9a-f]{2})+$/.test(j.reviewedHex) ||
      !Number.isSafeInteger(j.myFee) ||
      j.myFee! < 0
    )
      throw new Error('Invalid journal review');
    const tx = Transaction.fromHex(j.reviewedHex);
    if (
      tx.getId() !== j.reviewedId ||
      tx.hasWitnesses() ||
      tx.ins.some(i => i.script.length > 0) ||
      j.commitment !== utf8Hash(`${j.walletId}|${j.poolId}|${j.reviewedHex}|${j.myFee}`).toString('hex')
    )
      throw new Error('Invalid journal commitment');
    const inputs = new Set(tx.ins.map(i => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`));
    if (j.reserved.some(id => !inputs.has(id))) throw new Error('Journal inputs changed');
  }
  return clone(j);
}
export class Round {
  private journal: Journal;
  private busy = false;
  private constructor(
    journal: Journal,
    private readonly store: JournalStore,
  ) {
    this.journal = clone(journal);
  }

  static async join(
    walletId: string,
    poolId: string,
    selected: string[],
    deadline: number,
    now: number,
    store: JournalStore,
  ): Promise<Round> {
    if (
      !walletId ||
      !/^[0-9a-f]{16,64}$/.test(poolId) ||
      selected.length < 1 ||
      selected.length > 10 ||
      new Set(selected).size !== selected.length ||
      selected.some(s => !/^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/.test(s) || Number(s.split(':')[1]) > 0xffffffff) ||
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(deadline) ||
      now < 0 ||
      deadline <= now
    )
      throw new Error('Invalid round');
    const journal: Journal = {
      version: 1,
      walletId,
      poolId,
      phase: 'joined',
      reserved: [...selected],
      deadline,
    };
    await store.save(clone(journal));
    return new Round(journal, store);
  }

  static async restore(value: unknown, walletId: string, now: number, store: JournalStore): Promise<Round> {
    const journal = validateJournal(value);
    if (journal.walletId !== walletId || !Number.isSafeInteger(now) || now < 0) throw new Error('Wrong journal wallet/time');
    // A restart never retains approval. Signed or possibly shared inputs remain locked.
    if (['signed', 'uncertain'].includes(journal.phase)) journal.phase = 'uncertain';
    else if (!['complete', 'aborted'].includes(journal.phase)) {
      journal.phase = 'aborted';
      journal.reserved = [];
    }
    await store.save(clone(journal));
    return new Round(journal, store);
  }

  snapshot(): Journal {
    return clone(this.journal);
  }

  private async transition(next: Journal): Promise<void> {
    if (this.busy) throw new Error('Round transition already pending');
    this.busy = true;
    try {
      await this.store.save(clone(next));
      this.journal = clone(next);
    } finally {
      this.busy = false;
    }
  }

  private requirePhase(allowed: Phase[], now: number): void {
    if (this.busy || !allowed.includes(this.journal.phase)) throw new Error('Invalid round transition');
    if (!Number.isSafeInteger(now) || now < 0 || now >= this.journal.deadline) throw new Error('Round expired');
  }

  async review(plan: Plan, expected: Review, now: number): Promise<Journal> {
    this.requirePhase(['joined', 'review'], now);
    const mine = expected.mine.map(outpoint).sort();
    if (JSON.stringify(mine) !== JSON.stringify([...this.journal.reserved].sort())) throw new Error('Selected coins changed');
    const checked = review(plan, expected);
    const commitment = utf8Hash(`${this.journal.walletId}|${this.journal.poolId}|${checked.txHex}|${checked.myFee}`).toString('hex');
    await this.transition({
      ...this.journal,
      phase: 'review',
      reviewedHex: checked.txHex,
      reviewedId: checked.txid,
      commitment,
      myFee: checked.myFee,
    });
    return this.snapshot();
  }

  // Caller passes the exact commitment displayed in its explicit confirmation UI.
  async approve(commitment: string, now: number): Promise<void> {
    this.requirePhase(['review'], now);
    if (commitment !== this.journal.commitment) throw new Error('Review changed');
    await this.transition({ ...this.journal, phase: 'approved' });
  }

  // Call and persist BEFORE producing or sharing a signature. A crash can then never
  // make signed coins appear safe to reuse. No signing implementation is exposed here.
  async beforeSigning(commitment: string, now: number): Promise<void> {
    this.requirePhase(['approved'], now);
    if (commitment !== this.journal.commitment) throw new Error('Review changed');
    await this.transition({ ...this.journal, phase: 'signed' });
  }

  async cancel(): Promise<void> {
    if (this.busy || ['complete', 'aborted'].includes(this.journal.phase)) throw new Error('Invalid round transition');
    const exposed = ['signed', 'uncertain'].includes(this.journal.phase);
    await this.transition({
      ...this.journal,
      phase: exposed ? 'uncertain' : 'aborted',
      reserved: exposed ? this.journal.reserved : [],
    });
  }

  // Only independently confirmed chain evidence can retire a signed round. An unsigned
  // relay claim, timeout, or mempool absence is NOT sufficient to free these coins.
  async confirm(confirmedTxid: string, confirmations: number): Promise<void> {
    if (
      this.busy ||
      !['signed', 'uncertain'].includes(this.journal.phase) ||
      confirmedTxid !== this.journal.reviewedId ||
      !Number.isSafeInteger(confirmations) ||
      confirmations < 1
    )
      throw new Error('Unconfirmed round');
    await this.transition({ ...this.journal, phase: 'complete', reserved: [] });
  }
}
