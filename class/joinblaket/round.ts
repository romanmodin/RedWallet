// Durable lifecycle for a taker payment. No network, keys or signing here.
import { crypto } from 'bitcoinjs-lib';
import { sats } from './fees';
import { MakerWitness, validateUnsignedTransaction, verifyAllMakerWitnesses } from './signatures';
import { UnsignedPayment } from './transaction';

export type Phase = 'preparing' | 'review' | 'approved' | 'signing' | 'uncertain' | 'cancelled' | 'confirmed';
export type RoundJournal = Readonly<{
  version: 1;
  walletId: string;
  attemptId: string;
  phase: Phase;
  reserved: readonly string[];
  changeScript: string;
  deadline: number;
  payment?: UnsignedPayment;
  commitment?: string;
}>;
export interface RoundPersistence {
  save(journal: RoundJournal): Promise<void>;
}
export const holdsCoins = (phase: Phase) => phase !== 'cancelled' && phase !== 'confirmed';
export function validatePaymentSnapshot(value: UnsignedPayment): UnsignedPayment {
  if (!value || !Array.isArray(value.coins) || !Array.isArray(value.owners) || !Array.isArray(value.outputOwners))
    throw new Error('Invalid payment snapshot');
  const tx = validateUnsignedTransaction(value.hex, value.coins);
  if (
    value.txid !== tx.getId() ||
    value.owners.length !== tx.ins.length ||
    value.outputOwners.length !== tx.outs.length ||
    !value.owners.includes('taker') ||
    value.owners.every(o => o === 'taker') ||
    value.owners.some(o => typeof o !== 'string' || !/^[a-zA-Z0-9]{1,128}$/.test(o)) ||
    typeof value.changeScript !== 'string' ||
    !/^0014[0-9a-f]{40}$/.test(value.changeScript)
  )
    throw new Error('Invalid payment ownership');
  const participants = new Set(value.owners);
  const roles = new Set<string>();
  const scripts = new Set<string>();
  let amount: number | undefined;
  let takerOutputs = 0;
  tx.outs.forEach((o, i) => {
    const owner = value.outputOwners[i],
      script = Buffer.from(o.script).toString('hex'),
      n = sats(Number(o.value));
    if (
      !owner ||
      !participants.has(owner.owner) ||
      !['cj', 'change'].includes(owner.kind) ||
      roles.has(owner.owner + ':' + owner.kind) ||
      !/^0014[0-9a-f]{40}$/.test(script) ||
      scripts.has(script)
    )
      throw new Error('Invalid payment outputs');
    roles.add(owner.owner + ':' + owner.kind);
    scripts.add(script);
    if (owner.kind === 'cj') {
      if (!n || (amount !== undefined && amount !== n)) throw new Error('Unequal CoinJoin amounts');
      amount = n;
    }
    if (owner.owner === 'taker') {
      takerOutputs = sats(takerOutputs + n);
      if (owner.kind === 'change' && script !== value.changeScript) throw new Error('Change script mismatch');
    }
  });
  if ([...participants].some(p => !roles.has(p + ':cj'))) throw new Error('Missing participant output');
  const totalIn = value.coins.reduce((n, c) => sats(n + c.value), 0);
  const totalOut = tx.outs.reduce((n, o) => sats(n + Number(o.value)), 0);
  const takerIn = value.coins.reduce((n, c, i) => sats(n + (value.owners[i] === 'taker' ? c.value : 0)), 0);
  if (sats(value.totalFee) !== takerIn - takerOutputs || sats(value.minerFee) !== totalIn - totalOut)
    throw new Error('Payment fee mismatch');
  return Object.freeze({
    hex: value.hex,
    txid: value.txid,
    coins: Object.freeze(
      value.coins.map(c =>
        Object.freeze({ txid: c.txid.toLowerCase(), vout: c.vout, value: c.value, scriptPubKey: c.scriptPubKey.toLowerCase() }),
      ),
    ),
    owners: Object.freeze([...value.owners]),
    outputOwners: Object.freeze(value.outputOwners.map(o => Object.freeze({ owner: o.owner, kind: o.kind }))),
    totalFee: value.totalFee,
    minerFee: value.minerFee,
    changeScript: value.changeScript,
  });
}
function digest(walletId: string, attemptId: string, payment: UnsignedPayment): string {
  return Buffer.from(crypto.sha256(Buffer.from(JSON.stringify([walletId, attemptId, payment])))).toString('hex');
}
export function validateRound(value: unknown): RoundJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JoinBlaket journal');
  const j = value as RoundJournal;
  if (
    j.version !== 1 ||
    typeof j.walletId !== 'string' ||
    !j.walletId ||
    j.walletId.length > 128 ||
    typeof j.attemptId !== 'string' ||
    !/^[0-9a-f]{64}$/.test(j.attemptId) ||
    !['preparing', 'review', 'approved', 'signing', 'uncertain', 'cancelled', 'confirmed'].includes(j.phase) ||
    !Array.isArray(j.reserved) ||
    !j.reserved.length ||
    j.reserved.length > 128 ||
    new Set(j.reserved).size !== j.reserved.length ||
    j.reserved.some(s => typeof s !== 'string' || !/^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/.test(s) || Number(s.split(':')[1]) > 0xffffffff) ||
    typeof j.changeScript !== 'string' ||
    !/^0014[0-9a-f]{40}$/.test(j.changeScript) ||
    !Number.isSafeInteger(j.deadline) ||
    j.deadline < 1
  )
    throw new Error('Invalid JoinBlaket journal');
  let payment: UnsignedPayment | undefined;
  if (j.payment !== undefined) {
    payment = validatePaymentSnapshot(j.payment);
    const takerInputs = payment.coins
      .filter((_, i) => payment!.owners[i] === 'taker')
      .map(c => c.txid + ':' + c.vout)
      .sort();
    if (
      JSON.stringify(takerInputs) !== JSON.stringify([...j.reserved].sort()) ||
      j.changeScript !== payment.changeScript ||
      j.commitment !== digest(j.walletId, j.attemptId, payment)
    )
      throw new Error('JoinBlaket journal commitment mismatch');
  } else if (j.commitment !== undefined || !['preparing', 'cancelled'].includes(j.phase)) {
    throw new Error('Missing JoinBlaket review');
  }
  if (j.phase === 'preparing' && payment) throw new Error('Unexpected prepared review');
  return Object.freeze({
    version: 1,
    walletId: j.walletId,
    attemptId: j.attemptId,
    phase: j.phase,
    reserved: Object.freeze([...j.reserved]),
    changeScript: j.changeScript,
    deadline: j.deadline,
    ...(payment ? { payment, commitment: j.commitment } : {}),
  });
}
export class PaymentRound {
  private journal: RoundJournal;
  private busy = false;
  private readonly persistence: RoundPersistence;
  private constructor(journal: RoundJournal, persistence: RoundPersistence) {
    this.journal = validateRound(journal);
    this.persistence = persistence;
  }

  static async begin(
    walletId: string,
    attemptId: string,
    reserved: readonly string[],
    changeScript: string,
    deadline: number,
    now: number,
    persistence: RoundPersistence,
  ): Promise<PaymentRound> {
    if (!Number.isSafeInteger(now) || now < 0 || deadline <= now) throw new Error('Invalid round time');
    const j = validateRound({ version: 1, walletId, attemptId, reserved, changeScript, deadline, phase: 'preparing' });
    await persistence.save(j);
    return new PaymentRound(j, persistence);
  }

  static async restore(value: unknown, walletId: string, persistence: RoundPersistence): Promise<PaymentRound> {
    const j = validateRound(value);
    if (j.walletId !== walletId) throw new Error('Wrong JoinBlaket wallet');
    // Never carry a prior session's approval across an app restart.
    const phase: Phase = ['signing', 'uncertain'].includes(j.phase) ? 'uncertain' : holdsCoins(j.phase) ? 'cancelled' : j.phase;
    const next = validateRound({ ...j, phase });
    await persistence.save(next);
    return new PaymentRound(next, persistence);
  }

  snapshot(): RoundJournal {
    return validateRound(this.journal);
  }

  private requirePhase(phases: readonly Phase[], now?: number): void {
    if (this.busy || !phases.includes(this.journal.phase)) throw new Error('Invalid JoinBlaket transition');
    if (now !== undefined && (!Number.isSafeInteger(now) || now < 0 || now >= this.journal.deadline))
      throw new Error('JoinBlaket round expired');
  }

  private async persist(next: RoundJournal): Promise<void> {
    if (this.busy) throw new Error('JoinBlaket transition pending');
    const checked = validateRound(next);
    this.busy = true;
    try {
      await this.persistence.save(checked);
      this.journal = checked;
    } finally {
      this.busy = false;
    }
  }

  async review(payment: UnsignedPayment, now: number): Promise<string> {
    this.requirePhase(['preparing', 'review'], now);
    const checked = validatePaymentSnapshot(payment);
    const commitment = digest(this.journal.walletId, this.journal.attemptId, checked);
    await this.persist({ ...this.journal, phase: 'review', payment: checked, commitment });
    return commitment;
  }

  async approve(commitment: string, now: number): Promise<void> {
    this.requirePhase(['review'], now);
    if (commitment !== this.journal.commitment) throw new Error('Review changed');
    await this.persist({ ...this.journal, phase: 'approved' });
  }

  // Must finish BEFORE any taker signature is produced. A partial/failed durable
  // write cannot return permission to sign. Makers must all have signed first.
  async beforeSigning(commitment: string, witnesses: readonly MakerWitness[], now: number): Promise<void> {
    this.requirePhase(['approved'], now);
    if (commitment !== this.journal.commitment) throw new Error('Review changed');
    const p = this.journal.payment!;
    verifyAllMakerWitnesses(p.hex, p.coins, p.owners, witnesses);
    await this.persist({ ...this.journal, phase: 'signing' });
  }

  async cancel(): Promise<void> {
    this.requirePhase(['preparing', 'review', 'approved', 'signing', 'uncertain']);
    await this.persist({ ...this.journal, phase: ['signing', 'uncertain'].includes(this.journal.phase) ? 'uncertain' : 'cancelled' });
  }

  // Only an authenticated chain observer may supply this evidence. A directory
  // result, broadcast response, timeout or mempool absence cannot release coins.
  async confirm(txid: string, confirmations: number): Promise<void> {
    this.requirePhase(['signing', 'uncertain']);
    if (txid !== this.journal.payment!.txid || !Number.isSafeInteger(confirmations) || confirmations < 1)
      throw new Error('Unconfirmed JoinBlaket payment');
    await this.persist({ ...this.journal, phase: 'confirmed' });
  }
}
