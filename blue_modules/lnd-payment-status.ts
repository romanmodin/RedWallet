export type LndPaymentState = 'not_found' | 'pending' | 'settled' | 'failed' | 'unknown';
export type LndPaymentOutcome = { state: LndPaymentState | 'not_submitted'; reason?: string; alreadyPaid?: boolean };
type ReadPage = (cursor: string) => Promise<unknown>;

const hashPattern = /^[0-9a-f]{64}$/i;
const historyUnavailable = () => new Error('Could not verify Lightning payment history. No new payment was submitted.');

export async function findLndPayment(read: ReadPage, hash: string): Promise<LndPaymentState> {
  if (!hashPattern.test(hash)) throw historyUnavailable();
  let cursor = '0';
  let found: LndPaymentState = 'not_found';
  const visited = new Set<string>();
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    if (visited.has(cursor)) throw historyUnavailable();
    visited.add(cursor);
    const page = (await read(cursor)) as { rows?: unknown; next?: unknown; more?: unknown } | null;
    if (!page || !Array.isArray(page.rows) || page.rows.length > 100 || typeof page.more !== 'boolean') throw historyUnavailable();
    for (const item of page.rows) {
      const row = item as { id?: unknown; state?: unknown; direction?: unknown } | null;
      if (!row || typeof row.id !== 'string' || !hashPattern.test(row.id) || row.direction !== 'sent') throw historyUnavailable();
      if (row.id.toLowerCase() !== hash.toLowerCase()) continue;
      if (row.state === 'settled') return 'settled';
      if (row.state === 'pending') found = 'pending';
      else if (row.state === 'unknown') {
        if (found !== 'pending') found = 'unknown';
      } else if (row.state === 'failed') {
        if (found === 'not_found') found = 'failed';
      } else throw historyUnavailable();
    }
    if (!page.more) return found;
    if (
      typeof page.next !== 'string' ||
      !/^[1-9][0-9]*$/.test(page.next) ||
      page.rows.length === 0 ||
      (cursor !== '0' && BigInt(page.next) >= BigInt(cursor))
    ) {
      throw historyUnavailable();
    }
    cursor = page.next;
  }
  throw historyUnavailable();
}

// LND's persistent payment database remains authoritative across app restarts.
// Retain every unresolved hash while this screen is open, rather than replacing
// the previous payment's guard when a different invoice is entered.
export class LndPaymentTracker {
  private blocked = new Set<string>();
  private submissions = new Map<string, Promise<LndPaymentOutcome>>();
  private readonly read: ReadPage;
  constructor(read: ReadPage) {
    this.read = read;
  }

  async status(hash: string): Promise<LndPaymentState> {
    hash = hash.toLowerCase();
    const state = await findLndPayment(this.read, hash);
    if (state === 'settled' || state === 'pending' || state === 'unknown') this.blocked.add(hash);
    else if (state === 'failed') this.blocked.delete(hash);
    return state === 'not_found' && this.blocked.has(hash) ? 'unknown' : state;
  }

  submit(hash: string, send: () => Promise<boolean>): Promise<LndPaymentOutcome> {
    hash = hash.toLowerCase();
    const existing = this.submissions.get(hash);
    if (existing) return existing;
    const task = this.perform(hash, send).finally(() => this.submissions.delete(hash));
    this.submissions.set(hash, task);
    return task;
  }

  private async perform(hash: string, send: () => Promise<boolean>): Promise<LndPaymentOutcome> {
    let state: LndPaymentState;
    try {
      state = await this.status(hash);
    } catch {
      return this.blocked.has(hash) ? { state: 'unknown' } : { state: 'not_submitted', reason: 'history_unavailable' };
    }
    if (state !== 'not_found' && state !== 'failed') return { state, alreadyPaid: state === 'settled' };
    this.blocked.add(hash);
    try {
      const settled = await send();
      if (typeof settled !== 'boolean') throw new Error('Invalid payment result.');
      if (!settled) this.blocked.delete(hash);
      return { state: settled ? 'settled' : 'failed' };
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      const reasons: Record<string, string> = {
        payment_not_submitted_not_synced: 'not_synced',
        payment_not_submitted_invalid_invoice: 'invalid_invoice',
        payment_not_submitted_invalid_review: 'invalid_review',
        payment_not_submitted_unavailable: 'not_ready',
        payment_not_submitted_canceled: 'canceled',
      };
      if (typeof code === 'string' && reasons[code]) {
        this.blocked.delete(hash);
        return { state: 'not_submitted', reason: reasons[code] };
      }
      try {
        // Recover the node's result after an interrupted response. Never resend.
        return { state: await this.status(hash) };
      } catch {
        return { state: 'unknown' };
      }
    }
  }
}

export function lndPaymentMessage(outcome: LndPaymentOutcome): string {
  switch (outcome.state) {
    case 'settled':
      return outcome.alreadyPaid ? 'This invoice is already paid. No new payment was sent.' : 'Payment settled.';
    case 'failed':
      return 'Payment failed. Check channel balance and routing.';
    case 'pending':
      return 'Payment pending. The node is still resolving it. Do not resend this invoice.';
    case 'not_found':
      return 'No outgoing payment is recorded for this invoice.';
    case 'not_submitted':
      switch (outcome.reason) {
        case 'not_synced':
          return 'Payment not submitted. Wait for the XBT chain to finish syncing, then review the invoice again.';
        case 'invalid_invoice':
          return 'Payment not submitted. The node could not validate this XBT Lightning invoice.';
        case 'invalid_review':
          return 'Payment not submitted. The invoice, amount or fee no longer matches the review.';
        case 'canceled':
          return 'Action canceled. Nothing was submitted.';
        case 'history_unavailable':
          return 'Could not verify Lightning payment history. No new payment was submitted.';
        default:
          return 'Payment not submitted. The node could not verify its readiness. Check node status before reviewing again.';
      }
    default:
      return 'Payment result is not confirmed. Check payment status before trying again. Do not resend this invoice.';
  }
}
