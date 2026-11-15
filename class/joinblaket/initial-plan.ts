// Initial user confirmation, before any fill/PoDLE disclosure. Adapted from rc6 Taker.kt.
// This does not reserve coins, prove chain state, authorize signing, or broadcast.
import { Transaction, address, crypto, networks } from 'bitcoinjs-lib';
import { acceptable, checkMinerFee, decimal, miningFee, offerFee, sats, TAKER_DUST, vsizeEstimate } from './fees';
import { eligibleProofCoins, PaymentRequest, ProofCoin, validatePayment } from './preflight';
import { BondProof } from './offers';
import { isValidNick } from './nick';
import { Selection, ValuedOffer } from './selection';
import { validatePaymentSnapshot } from './round';
import { UnsignedPayment } from './transaction';

export type PlanCoin = ProofCoin & Readonly<{ scriptPubKey: string }>;
export type PlanContext = Readonly<{ walletId: string; attemptId: string; nick: string; tip: number; tipHash: string }>;
export type PlanRequest = PlanContext &
  PaymentRequest &
  Readonly<{
    coins: readonly PlanCoin[];
    proofOutpoint: string; // Chosen locally for a fresh PoDLE; the store must still consume it durably later.
    changeAddress: string;
    feeRate: string;
    minimumMakers: number;
  }>;
export type InitialReview = Readonly<{
  id: string;
  recipient: string;
  amount: number;
  makers: readonly Readonly<{ fee: number; bondValue: string }>[];
  minimumMakers: number;
  inputs: number;
  inputTotal: number;
  feeRate: string;
  makerFees: number;
  miningFeeEstimate: number;
  miningFeeMax: number; // Includes the maximum possible unreturned dust change.
  dustAllowance: number;
  totalEstimate: number;
  totalMax: number;
}>;
export type PreparedPlan = Readonly<{ review: InitialReview }>;
export type ApprovedPlan = Readonly<{ review: InitialReview }>;
export type DisclosurePlan = Readonly<{
  context: PlanContext;
  review: InitialReview;
  coins: readonly PlanCoin[];
  proofOutpoint: string;
  changeAddress: string;
  makers: readonly Readonly<{ offer: ValuedOffer; fee: number }>[];
}>;
const prepared = new WeakMap<PreparedPlan, { plan: DisclosurePlan; used: boolean }>();
const approved = new WeakMap<
  ApprovedPlan,
  {
    plan: DisclosurePlan;
    deadline: number;
    started: number;
    now: () => number;
    isCurrent: () => boolean;
  }
>();
const disclosed = new WeakSet<DisclosurePlan>();
const sum = (values: readonly number[]) => values.reduce((a, b) => sats(a + sats(b)), 0);
const outpoint = (coin: ProofCoin) => coin.txid.toLowerCase() + ':' + coin.vout;
function p2wpkh(text: string): string {
  if (typeof text !== 'string' || text.length > 90) throw new Error('Invalid plan address');
  const hex = Buffer.from(address.toOutputScript(text, networks.bitcoin)).toString('hex');
  if (!/^0014[0-9a-f]{40}$/.test(hex)) throw new Error('Plan requires native SegWit addresses');
  return hex;
}
function contextOf(value: PlanContext): PlanContext {
  if (
    typeof value.walletId !== 'string' ||
    !value.walletId ||
    value.walletId.length > 128 ||
    !/^[0-9a-f]{64}$/.test(value.attemptId) ||
    !isValidNick(value.nick) ||
    !Number.isSafeInteger(value.tip) ||
    value.tip <= 0 ||
    value.tip > 0xffffffff ||
    typeof value.tipHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.tipHash)
  )
    throw new Error('Invalid plan context');
  return Object.freeze({ walletId: value.walletId, attemptId: value.attemptId, nick: value.nick, tip: value.tip, tipHash: value.tipHash });
}

/** Inputs/selection must already come from the wallet and independently verified chain view. */
export function prepareInitialPlan(request: PlanRequest, selection: Selection): PreparedPlan {
  const context = contextOf(request),
    payment = validatePayment(request);
  const recipientScript = p2wpkh(payment.address),
    changeScript = p2wpkh(request.changeAddress);
  if (recipientScript === changeScript) throw new Error('Recipient and change must differ');
  if (!Array.isArray(request.coins) || !request.coins.length || request.coins.length > 10_000) throw new Error('Invalid plan coin count');
  const coins = request.coins.map(c => {
    if (!/^0014[0-9a-f]{40}$/i.test(c.scriptPubKey) || sats(c.value) === 0) throw new Error('Invalid plan input');
    return Object.freeze({
      txid: c.txid.toLowerCase(),
      vout: c.vout,
      value: c.value,
      height: c.height,
      frozen: c.frozen,
      reserved: c.reserved,
      scriptPubKey: c.scriptPubKey.toLowerCase(),
    });
  });
  const eligible = eligibleProofCoins(coins, payment.amount, context.tip);
  const proof = coins.find(c => outpoint(c) === request.proofOutpoint);
  if (!proof || !eligible.some(c => outpoint(c) === request.proofOutpoint)) throw new Error('Eligible proof coin required');
  if (
    !selection ||
    !Array.isArray(selection.offers) ||
    selection.offers.length < 1 ||
    selection.offers.length > 9 ||
    !Number.isInteger(request.minimumMakers) ||
    request.minimumMakers < 1 ||
    request.minimumMakers > selection.offers.length
  )
    throw new Error('Invalid plan maker count');
  const nicks = new Set<string>(),
    bonds = new Set<string>();
  const makers = selection.offers.map(o => {
    const nick = o.offer.counterparty,
      claim = o.bond.txid + ':' + o.bond.vout;
    if (
      !(o.bond instanceof BondProof) ||
      !isValidNick(nick) ||
      nicks.has(nick) ||
      bonds.has(claim) ||
      !Number.isSafeInteger(o.offer.oid) ||
      o.offer.oid < 0 ||
      !acceptable(o.offer, payment.amount) ||
      typeof o.value !== 'bigint' ||
      o.value <= 0n ||
      o.value > 0x7fffffffffffffffn ||
      o.problem ||
      o.bond.expiredAt(context.tip) ||
      (!o.bond.verify(nick, context.nick) && !o.bond.verify(nick, nick))
    )
      throw new Error('Invalid plan maker');
    nicks.add(nick);
    bonds.add(claim);
    const fee = selection.fees.get(nick);
    if (fee === undefined) throw new Error('Missing maker fee');
    return Object.freeze({ offer: Object.freeze({ offer: Object.freeze({ ...o.offer }), bond: o.bond, value: o.value }), fee: sats(fee) });
  });
  const quoted = makers.map(m => offerFee(m.offer.offer, payment.amount)),
    highest = Math.max(...quoted);
  if (selection.fees.size !== makers.length || (!makers.every((m, i) => m.fee === quoted[i]) && !makers.every(m => m.fee === highest)))
    throw new Error('Maker fee plan changed');
  const makerFees = sum(makers.map(m => m.fee));
  if (selection.totalFee !== makerFees) throw new Error('Maker fee total changed');
  const rate = decimal(request.feeRate).toFixed(),
    count = makers.length,
    outputs = 2 + 2 * count;
  const selected = [proof];
  const others = coins
    .filter(c => c !== proof && !c.frozen && !c.reserved && c.height > 0)
    .sort((a, b) => b.value - a.value || outpoint(a).localeCompare(outpoint(b)));
  const ceiling = () => miningFee(selected.length + 5 * count, outputs, rate);
  const need = () => sum([payment.amount, makerFees, ceiling()]);
  let total = proof.value;
  for (const coin of others) {
    if (total >= need()) break;
    if (selected.length + 1 + 5 * count > 128) throw new Error('Too many plan inputs');
    selected.push(coin);
    total = sum([total, coin.value]);
  }
  const baseMax = ceiling();
  if (total < need()) throw new Error('Not enough confirmed coins for the fee ceiling');
  // rc6 pre-disclosure rate headroom: account for maker contributions and discarded dust.
  const smallestInputs = selected.length + count,
    smallestOutputs = 1 + 2 * count;
  const complete = sum([miningFee(smallestInputs, smallestOutputs + 1, rate), sum(makers.map(m => m.offer.offer.txfee)), TAKER_DUST, 1]);
  if (complete > 100 * vsizeEstimate(smallestInputs, smallestOutputs)) throw new Error('Insufficient mining fee headroom');
  const remainderAtCeiling = total - payment.amount - makerFees - baseMax;
  // If even the largest fee leaves > dust, change is always returned. Otherwise the entire
  // remainder may become fee. This displays and enforces that cost instead of hiding it.
  const dustAllowance = remainderAtCeiling <= TAKER_DUST ? remainderAtCeiling : 0;
  const miningMax = sum([baseMax, dustAllowance]);
  const estimate = miningFee(selected.length + 2 * count, outputs, rate);
  const estimatedChange = total - payment.amount - makerFees - estimate;
  const miningEstimate = sum([estimate, estimatedChange <= TAKER_DUST ? estimatedChange : 0]);
  const publicFields = {
    recipient: payment.address,
    amount: payment.amount,
    makers: Object.freeze(makers.map(m => Object.freeze({ fee: m.fee, bondValue: m.offer.value.toString() }))),
    minimumMakers: request.minimumMakers,
    inputs: selected.length,
    inputTotal: total,
    feeRate: rate,
    makerFees,
    miningFeeEstimate: miningEstimate,
    miningFeeMax: miningMax,
    dustAllowance,
    totalEstimate: sum([makerFees, miningEstimate]),
    totalMax: sum([makerFees, miningMax]),
  };
  const identity = JSON.stringify([
    context,
    publicFields,
    request.changeAddress,
    selected,
    makers.map(m => [m.offer.offer, m.offer.bond, m.offer.value.toString(), m.fee]),
    request.proofOutpoint,
  ]);
  const review = Object.freeze({ id: Buffer.from(crypto.sha256(Buffer.from(identity))).toString('hex'), ...publicFields });
  const plan = Object.freeze({
    context,
    review,
    coins: Object.freeze(selected),
    proofOutpoint: request.proofOutpoint,
    changeAddress: request.changeAddress,
    makers: Object.freeze(makers),
  });
  const result = Object.freeze({ review });
  prepared.set(result, { plan, used: false });
  return result;
}

/** Explicit confirmation only. Late UI answers cannot revive a cancelled, expired or changed plan. */
export async function approveInitialPlan(
  draft: PreparedPlan,
  confirm: (review: InitialReview, signal: AbortSignal) => Promise<boolean>,
  options: Readonly<{ isCurrent: () => boolean; signal?: AbortSignal; timeoutMs?: number; now?: () => number }>,
): Promise<ApprovedPlan> {
  const state = prepared.get(draft);
  if (!state || state.used) throw new Error('Plan is missing or already reviewed');
  const timeout = options.timeoutMs ?? 300_000,
    now = options.now ?? (() => performance.now()),
    signal = options.signal,
    isCurrent = options.isCurrent;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000 || typeof isCurrent !== 'function')
    throw new Error('Invalid confirmation options');
  state.used = true;
  const started = now(),
    deadline = started + timeout,
    abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, detach: (() => void) | undefined;
  const current = () => {
    if (signal?.aborted || abort.signal.aborted) throw new Error('Plan confirmation cancelled');
    const time = now();
    if (!Number.isFinite(started) || !Number.isFinite(deadline) || !Number.isFinite(time) || time < started || time >= deadline)
      throw new Error('Plan confirmation expired');
    if (isCurrent() !== true) throw new Error('Payment context changed');
  };
  try {
    current();
    const yes = await new Promise<boolean>((resolve, reject) => {
      const cancel = () => {
        abort.abort();
        reject(new Error('Plan confirmation cancelled'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      detach = () => signal?.removeEventListener('abort', cancel);
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('Plan confirmation expired'));
      }, timeout);
      // Register cancellation before calling UI code, including a synchronously throwing callback.
      Promise.resolve()
        .then(() => {
          current();
          return confirm(state.plan.review, abort.signal);
        })
        .then(resolve, reject);
    });
    current();
    if (yes !== true) throw new Error('Plan confirmation declined');
    const result = Object.freeze({ review: state.plan.review });
    approved.set(result, { plan: state.plan, deadline, started, now, isCurrent: () => !signal?.aborted && isCurrent() === true });
    return result;
  } catch (error) {
    const known = ['Plan confirmation cancelled', 'Plan confirmation expired', 'Plan confirmation declined', 'Payment context changed'];
    throw new Error(error instanceof Error && known.includes(error.message) ? error.message : 'Plan confirmation failed');
  } finally {
    clearTimeout(timer);
    detach?.();
    abort.abort();
  }
}

/** One use by the session controller, immediately before durable commitment consumption/fill.
 * The controller must still reserve/revalidate inputs, consume a fresh proof durably, and later
 * obtain exact-transaction approval and all maker signatures through PaymentRound.
 */
export function takeApprovedPlan(token: ApprovedPlan, context: PlanContext): DisclosurePlan {
  const state = approved.get(token);
  approved.delete(token);
  if (!state) throw new Error('Plan approval missing or already used');
  try {
    const time = state.now();
    if (
      !Number.isFinite(time) ||
      time < state.started ||
      time >= state.deadline ||
      state.isCurrent() !== true ||
      JSON.stringify(contextOf(context)) !== JSON.stringify(state.plan.context)
    )
      throw new Error();
  } catch {
    throw new Error('Plan approval is stale');
  }
  disclosed.add(state.plan);
  return state.plan;
}

/** Bind the constructed transaction back to the earlier approval before asking makers for signatures.
 * Only original approved makers are permitted here; replacements require a newly confirmed plan.
 * PaymentRound still supplies the later exact-transaction approval and signer gate.
 */
export function assertPaymentMatchesPlan(plan: DisclosurePlan, value: UnsignedPayment): void {
  if (!disclosed.has(plan)) throw new Error('Consumed initial approval required');
  const payment = validatePaymentSnapshot(value),
    tx = Transaction.fromHex(payment.hex);
  const key = (c: { txid: string; vout: number; value: number; scriptPubKey: string }) =>
    [c.txid, c.vout, c.value, c.scriptPubKey].join(':');
  const expected = plan.coins.map(key).sort();
  const actual = payment.coins
    .filter((_, i) => payment.owners[i] === 'taker')
    .map(key)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) || payment.changeScript !== p2wpkh(plan.changeAddress))
    throw new Error('Payment inputs or change differ from approved plan');
  const recipient = payment.outputOwners.findIndex(o => o.owner === 'taker' && o.kind === 'cj');
  if (
    recipient < 0 ||
    Number(tx.outs[recipient].value) !== plan.review.amount ||
    Buffer.from(tx.outs[recipient].script).toString('hex') !== p2wpkh(plan.review.recipient)
  )
    throw new Error('Payment recipient differs from approved plan');
  const active = [...new Set(payment.owners.filter(o => o !== 'taker'))];
  if (active.length < plan.review.minimumMakers) throw new Error('Too few approved makers');
  let makerFees = 0;
  for (const nick of active) {
    const maker = plan.makers.find(m => m.offer.offer.counterparty === nick);
    if (!maker) throw new Error('Unapproved maker');
    const inputs = sum(payment.coins.filter((_, i) => payment.owners[i] === nick).map(c => c.value));
    const outputs = sum(tx.outs.filter((_, i) => payment.outputOwners[i].owner === nick).map(o => Number(o.value)));
    if (outputs - inputs + maker.offer.offer.txfee !== maker.fee) throw new Error('Maker fee differs from approved plan');
    makerFees = sum([makerFees, maker.fee]);
  }
  const mining = payment.totalFee - makerFees;
  if (mining < 0 || mining > plan.review.miningFeeMax || payment.totalFee > plan.review.totalMax)
    throw new Error('Payment exceeds approved fee ceiling');
  checkMinerFee(sum(payment.coins.map(c => c.value)), sum(tx.outs.map(o => Number(o.value))), tx.ins.length, tx.outs.length);
}
