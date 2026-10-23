/** Participant-only v3/v4 controller. Transport and secure persistence are injected.
 * This controller never automatically signs or broadcasts a transaction.
 */
import { script as bitcoinScript } from 'bitcoinjs-lib';
import ecc from '../../../blue_modules/noble_ecc';
import { blind, finalize, prepare, publicKey, RandomBytes } from './blind-rsa';
import { conversationKey, encrypt, hash, hex, NostrEvent, signEvent } from './crypto';
import { MessageInbox } from './messages';
import { changeMessage, memberMac, passwordKey, passwordProof, Terms, tokenHash, outputCount } from './protocol';
import { ChainCoin, Seat, validateRoster } from './roster';
import { Journal, Round } from './round';
import { assemble, coinScript, isType, outpoint, Plan, plan, Review, verifySignature } from './transaction';

type OutputState = {
  script: string;
  prepared: string;
  inverse: string;
  blinded: string;
  signature?: string;
  notBefore?: number;
  submitted?: boolean;
};
type Phase = 'joining' | 'open' | 'voting' | 'closing' | 'review' | 'signed' | 'aborted';
export type SessionState = {
  phase: Phase;
  sequence: number;
  seats: Seat[];
  token?: string;
  poolSecret?: string;
  voteId?: string;
  roundId?: string;
  deadline: number;
  prepared?: string;
  inverse?: string;
  blinded?: string;
  outputSignature?: string;
  outputNotBefore?: number;
  outputStates?: OutputState[];
  outputs?: string[];
  signatures: Record<string, string>;
};
export interface SessionEnvironment {
  now(): number;
  random: RandomBytes;
  // Must use encrypted native storage. State includes membership secrets, never spending keys.
  saveEncrypted(state: SessionState): Promise<void>;
  observe(coins: Seat['coins']): Promise<ReadonlyMap<string, ChainCoin>>;
  walletOutpoints(): ReadonlySet<string>;
  publish(event: NostrEvent, isolatedOutputConnection: boolean): Promise<void>;
}
const copy = (s: SessionState): SessionState => JSON.parse(JSON.stringify(s));
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{16,64}$/.test(value)) throw new Error('Invalid round/vote identifier');
  return value;
};
export class ParticipantSession {
  private state: SessionState;
  private readonly inbox: MessageInbox;
  private readonly joinSecret: Buffer;
  private readonly terms: Readonly<Terms>;
  private readonly seat: Seat;
  private readonly mixScripts: string[];
  private welcomeSequenceFloor = -1;
  private pendingInitialVote?: {
    by: string;
    voteId: string;
    createdAt: number;
  };

  private busy = false;
  private idle: Promise<void> = Promise.resolve();
  constructor(
    terms: Readonly<Terms>,
    seat: Seat,
    joinSecret: Uint8Array,
    mixScript: string | string[],
    private readonly maxFee: number,
    private readonly round: Round,
    private readonly env: SessionEnvironment,
  ) {
    this.terms = Object.freeze({ ...terms });
    this.mixScripts = typeof mixScript === 'string' ? [mixScript] : [...mixScript];
    this.seat = JSON.parse(JSON.stringify(seat));
    this.joinSecret = Buffer.from(joinSecret);
    const joinPub = Buffer.from(ecc.pointFromScalar(joinSecret, true)!.slice(1)).toString('hex');
    const journal = round.snapshot();
    if (
      seat.join_pub !== joinPub ||
      this.mixScripts.length !== outputCount(terms) ||
      new Set(this.mixScripts).size !== this.mixScripts.length ||
      this.mixScripts.some(s => !isType(s, terms.script)) ||
      !Number.isSafeInteger(maxFee) ||
      maxFee < 0 ||
      journal.poolId !== terms.id ||
      journal.phase !== 'joined' ||
      JSON.stringify([...journal.reserved].sort()) !== JSON.stringify(seat.coins.map(outpoint).sort()) ||
      seat.coins.some(c => this.mixScripts.includes(coinScript(c).toString('hex'))) ||
      this.mixScripts.includes(seat.change_script)
    )
      throw new Error('Invalid participant configuration');
    this.inbox = new MessageInbox(terms.creator, terms.public_key, joinSecret, env.now());
    this.state = {
      phase: 'joining',
      sequence: -1,
      seats: [],
      signatures: {},
      deadline: journal.deadline,
    };
  }

  async sendJoin(changeSignature: string, password?: string): Promise<void> {
    return this.exclusive(async () => {
      this.require(['joining']);
      const first = this.seat.coins[0];
      const compact = bitcoinScript.signature.decode(Buffer.concat([hex(changeSignature), Buffer.from([1])])).signature;
      if (
        !ecc.verify(
          changeMessage(this.terms.id, this.seat.coins, this.seat.change_script, this.seat.change_value),
          hex(first.pubkey, 33),
          compact,
          false,
        )
      )
        throw new Error('Invalid change authorization');
      if (this.terms.private && !password) throw new Error('Private pool password required');
      await this.save(this.state);
      const body = {
        type: 'join',
        seat: { ...this.seat, coin: first },
        proof: this.seat.proofs[0],
        proofs: this.seat.proofs,
        change_sig: changeSignature,
        ...(this.terms.private
          ? {
              pw: passwordProof(passwordKey(this.terms.id, password!), this.seat.join_pub),
            }
          : {}),
      };
      const recipient = this.terms.public_key;
      await this.env.publish(
        signEvent(
          {
            kind: 2023,
            created_at: this.env.now(),
            tags: [['p', recipient]],
            content: encrypt(JSON.stringify(body), conversationKey(this.joinSecret, recipient), this.env.random(32)),
          },
          this.joinSecret,
          this.env.random(32),
        ),
        false,
      );
    });
  }

  snapshot(): SessionState {
    // Never expose membership secrets to UI/logging through this method.
    const state = copy(this.state);
    delete state.token;
    delete state.poolSecret;
    delete state.prepared;
    delete state.inverse;
    delete state.outputStates;
    return state;
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Session action pending');
    this.busy = true;
    let release!: () => void;
    this.idle = new Promise(resolve => {
      release = resolve;
    });
    try {
      return await action();
    } finally {
      this.busy = false;
      release();
    }
  }

  private require(phases: Phase[]): void {
    if (!phases.includes(this.state.phase) || this.env.now() >= this.state.deadline) throw new Error('Invalid or expired session phase');
  }

  private async save(next: SessionState): Promise<void> {
    try {
      await this.env.saveEncrypted(copy(next));
    } catch {
      // Persist no raw native error text: it can contain storage identifiers.
      throw new Error('Session persistence failed');
    }
    this.state = copy(next);
  }

  private votingState(base: SessionState, vote: { by: string; voteId: string; createdAt: number }): SessionState {
    if (base.seats.length < this.terms.min_peers || !base.seats.some(s => s.token_hash === vote.by)) throw new Error('Invalid vote caller');
    const deadline = Math.min(base.deadline, vote.createdAt + 600);
    if (this.env.now() >= deadline) throw new Error('Invalid or expired session phase');
    return { ...base, phase: 'voting', voteId: vote.voteId, deadline };
  }

  private async publish(body: Record<string, unknown>, isolated = false): Promise<void> {
    const secret = isolated ? this.freshSecret() : hex(this.state.poolSecret!, 32);
    const recipient = isolated ? this.terms.creator : this.terms.public_key;
    try {
      const event = signEvent(
        {
          kind: 2023,
          created_at: this.env.now(),
          tags: [['p', recipient]],
          content: encrypt(JSON.stringify(body), conversationKey(secret, recipient), this.env.random(32)),
        },
        secret,
        this.env.random(32),
      );
      await this.env.publish(event, isolated);
    } finally {
      secret.fill(0);
    }
  }

  private freshSecret(): Buffer {
    for (let i = 0; i < 128; i++) {
      const key = Buffer.from(this.env.random(32));
      if (ecc.isPrivate(key)) return key;
    }
    throw new Error('Unable to generate fresh identity');
  }

  private ownSeat(): Seat {
    return { ...this.seat, token_hash: tokenHash(this.state.token!) };
  }

  private async checkedSeats(seats: unknown, seq: number): Promise<Seat[]> {
    // Parse/ownership-check first, before making network requests for arbitrary relay data.
    const { parseSeat } = await import('./roster');
    if (!Array.isArray(seats) || seats.length > this.terms.max_peers) throw new Error('Invalid seats');
    const parsed = seats.map(s => parseSeat(s, this.terms));
    const chain = await this.env.observe(parsed.flatMap(s => s.coins));
    return validateRoster({ type: 'roster', seq, seats }, this.terms, {
      previousSeq: this.state.sequence,
      ownSeat: this.ownSeat(),
      walletOutpoints: this.env.walletOutpoints(),
      chain,
      now: this.env.now(),
    }).seats;
  }

  async receive(event: NostrEvent): Promise<void> {
    // A welcome can arrive before the relay acknowledges our join publication.
    await this.idle;
    return this.exclusive(async () => {
      const message = this.inbox.receive(event, this.env.now()),
        body = message.body;
      switch (body.type) {
        case 'welcome': {
          this.require(['joining']);
          // Kilowallet serializes this scalar with BigInteger.toString(16), without leading zeros.
          // Normalize only this field; all other protocol hex remains canonical.
          if (typeof body.pool_secret !== 'string' || !/^[0-9a-f]{1,64}$/.test(body.pool_secret)) throw new Error('Invalid welcome');
          const poolSecret = hex(body.pool_secret.padStart(64, '0'), 32);
          try {
            if (
              !ecc.isPrivate(poolSecret) ||
              Buffer.from(ecc.pointFromScalar(poolSecret, true)!.slice(1)).toString('hex') !== this.terms.public_key ||
              typeof body.token !== 'string' ||
              !/^[0-9a-f]{32,128}$/.test(body.token) ||
              !Number.isSafeInteger(body.seq) ||
              (body.seq as number) < 0
            )
              throw new Error('Invalid welcome');
            await this.save({
              ...this.state,
              phase: 'open',
              poolSecret: poolSecret.toString('hex'),
              token: body.token,
              sequence: (body.seq as number) - 1,
            });
            this.welcomeSequenceFloor = (body.seq as number) - 1;
            this.inbox.installPoolSecret(poolSecret);
          } finally {
            poolSecret.fill(0);
          }
          break;
        }
        case 'reject':
        case 'abort':
          await this.round.cancel();
          await this.save({ ...this.state, phase: 'aborted' });
          break;
        case 'roster': {
          if (!Number.isSafeInteger(body.seq) || (body.seq as number) < 0) throw new Error('Invalid roster sequence');
          // Authenticated relay history can predate our seat. It cannot update this round.
          // Newer/current rosters still pass strict replay, ownership and chain validation.
          if ((body.seq as number) <= this.welcomeSequenceFloor) break;
          this.require(['open', 'voting']);
          const seats = await this.checkedSeats(body.seats, body.seq as number);
          const next: SessionState = {
            ...this.state,
            seats,
            sequence: body.seq as number,
          };
          // A fresh pool subscription can return stored vote_open before roster
          // (NIP-01 newest-first history, including timestamp ties). Accept the
          // vote only after all roster/ownership/chain checks, in one durable save.
          await this.save(this.pendingInitialVote ? this.votingState(next, this.pendingInitialVote) : next);
          this.pendingInitialVote = undefined;
          break;
        }
        case 'vote_open': {
          this.require(['open']);
          const vote = {
            by: hex(body.by as string, 32).toString('hex'),
            voteId: identifier(body.vote_id),
            createdAt: message.createdAt,
          };
          if (this.state.seats.length === 0) {
            // The authenticated creator's one bounded pending request cannot
            // trigger voting, publishing or signing without a verified roster.
            if (this.pendingInitialVote) throw new Error('Conflicting initial vote');
            this.pendingInitialVote = vote;
            break;
          }
          await this.save(this.votingState(this.state, vote));
          break;
        }
        case 'reopen':
          this.require(['voting']);
          if (body.vote_id !== this.state.voteId) throw new Error('Wrong vote');
          await this.save({
            ...this.state,
            phase: 'open',
            voteId: undefined,
            deadline: this.round.snapshot().deadline,
          });
          break;
        case 'closing': {
          this.require(['open', 'voting']);
          const roundId = identifier(body.round_id),
            seats = await this.checkedSeats(body.seats, this.state.sequence + 1);
          if (seats.length < this.terms.min_peers) throw new Error('Too few participants');
          const deadline = body.deadline ?? message.createdAt + 300;
          if (!Number.isSafeInteger(deadline) || (deadline as number) <= this.env.now() || (deadline as number) > message.createdAt + 300)
            throw new Error('Invalid closing deadline');
          const outputStates = this.mixScripts.map(script => {
            const prepared = prepare(hex(script), this.env.random);
            const blinded = blind(publicKey(this.terms.blind_key), prepared, this.env.random);
            return {
              script,
              prepared: prepared.toString('hex'),
              inverse: blinded.inv.toString(16),
              blinded: blinded.blinded.toString('hex'),
            };
          });
          await this.save({
            ...this.state,
            phase: 'closing',
            seats,
            roundId,
            deadline: Math.min(deadline as number, this.round.snapshot().deadline),
            prepared: outputStates[0].prepared,
            inverse: outputStates[0].inverse,
            blinded: outputStates[0].blinded,
            outputStates,
          });
          await this.sendBlind();
          break;
        }
        case 'blind_sig': {
          this.require(['closing']);
          if (body.token_hash !== this.ownSeat().token_hash) return;
          if (body.round_id !== this.state.roundId || this.state.outputSignature) throw new Error('Unexpected blind signature');
          const sigs = this.terms.v === 4 ? body.sigs : [body.sig];
          const pending = this.state.outputStates!;
          if (!Array.isArray(sigs) || sigs.length !== pending.length) throw new Error('Blind signature count mismatch');
          const outputStates = pending.map((output, i) => {
            const sig = finalize(
              publicKey(this.terms.blind_key),
              hex(output.prepared),
              hex(sigs[i] as string),
              BigInt('0x' + output.inverse),
            );
            const entropy = this.env.random(1);
            if (entropy.length !== 1) throw new Error('Invalid entropy');
            return {
              ...output,
              signature: sig.toString('hex'),
              notBefore: this.env.now() + 3 + (entropy[0] % 41),
            };
          });
          await this.save({
            ...this.state,
            outputStates,
            outputSignature: outputStates[0].signature,
            outputNotBefore: Math.min(...outputStates.map(o => o.notBefore)),
          });
          break;
        }
        case 'outputs': {
          this.require(['closing']);
          if (
            !this.state.outputSignature ||
            body.round_id !== this.state.roundId ||
            !Array.isArray(body.scripts) ||
            body.scripts.length !== this.state.seats.length * outputCount(this.terms) ||
            !body.scripts.every(s => typeof s === 'string' && isType(s, this.terms.script))
          )
            throw new Error('Invalid outputs');
          const outputs = body.scripts as string[],
            next = { ...this.state, outputs };
          const p = this.buildPlan(next),
            expected = await this.reviewContext();
          await this.round.review(p, expected, this.env.now());
          await this.save({
            ...next,
            phase: 'review',
            deadline: Math.min(this.round.snapshot().deadline, this.env.now() + 1200),
          });
          break;
        }
        case 'sig': {
          this.require(['review', 'signed']);
          const p = this.buildPlan(),
            index = p.coins.findIndex(c => outpoint(c) === body.outpoint);
          if (index < 0 || typeof body.sig !== 'string' || !verifySignature(p, index, body.sig))
            throw new Error('Invalid participant signature');
          const old = this.state.signatures[body.outpoint as string];
          if (old && old !== body.sig) throw new Error('Conflicting signature');
          await this.save({
            ...this.state,
            signatures: {
              ...this.state.signatures,
              [body.outpoint as string]: body.sig,
            },
          });
          break;
        }
        // Peer transaction claims are never used as confirmation or to release reservations.
        case 'tx':
          break;
        default:
          break; // Coordinator-only member requests have no participant-side authority.
      }
    });
  }

  async requestClose(): Promise<void> {
    return this.exclusive(async () => {
      this.require(['open']);
      if (this.state.seats.length < this.terms.min_peers) throw new Error('Too few participants');
      const voteId = Buffer.from(this.env.random(8)).toString('hex');
      identifier(voteId);
      await this.publish({
        type: 'close_request',
        token_hash: this.ownSeat().token_hash,
        vote_id: voteId,
        mac: memberMac(this.state.token!, 'close', voteId),
      });
    });
  }

  async retrySignatures(): Promise<void> {
    return this.exclusive(async () => {
      this.require(['signed']);
      const p = this.buildPlan();
      for (const coin of this.seat.coins) {
        const id = outpoint(coin),
          sig = this.state.signatures[id],
          index = p.coins.findIndex(c => outpoint(c) === id);
        if (!sig || !verifySignature(p, index, sig)) throw new Error('No persisted signature to retry');
        await this.publish({ type: 'sig', outpoint: id, sig });
      }
    });
  }

  private async sendBlind(): Promise<void> {
    await this.publish({
      type: 'blind',
      token_hash: this.ownSeat().token_hash,
      round_id: this.state.roundId,
      blinded: this.terms.v === 4 ? this.state.outputStates!.map(o => o.blinded) : this.state.blinded,
      mac: memberMac(
        this.state.token!,
        'blind',
        this.state.roundId!,
        hash(Buffer.concat(this.state.outputStates!.map(o => hex(o.blinded)))).toString('hex'),
      ),
    });
  }

  async retryBlind(): Promise<void> {
    return this.exclusive(async () => {
      this.require(['closing']);
      if (!this.state.outputSignature) await this.sendBlind();
    });
  }

  async submitOutput(): Promise<void> {
    return this.exclusive(async () => {
      this.require(['closing']);
      if (!this.state.outputSignature || this.env.now() < this.state.outputNotBefore!) throw new Error('Output is not ready');
      const pending = this.state.outputStates!;
      for (let i = 0; i < pending.length; i++) {
        const output = pending[i];
        if (output.submitted || this.env.now() < output.notBefore!) continue;
        await this.publish(
          {
            type: 'output',
            round_id: this.state.roundId,
            script: output.script,
            prefix: output.prepared.slice(0, 64),
            sig: output.signature,
          },
          true,
        );
        const outputStates = this.state.outputStates!.map((o, index) => (index === i ? { ...o, submitted: true } : o));
        const remaining = outputStates.filter(o => !o.submitted);
        await this.save({
          ...this.state,
          outputStates,
          outputNotBefore: remaining.length ? Math.min(...remaining.map(o => o.notBefore!)) : undefined,
        });
      }
    });
  }

  async vote(accept: boolean): Promise<void> {
    return this.exclusive(async () => {
      this.require(['voting']);
      await this.publish({
        type: 'vote',
        token_hash: this.ownSeat().token_hash,
        vote_id: this.state.voteId,
        accept,
        mac: memberMac(this.state.token!, 'vote', this.state.voteId!, accept),
      });
    });
  }

  private buildPlan(state = this.state): Plan {
    if (!state.outputs) throw new Error('Outputs missing');
    return plan(
      state.seats.flatMap(s => s.coins),
      state.outputs,
      state.seats.filter(s => s.change_value > 0).map(s => ({ script: s.change_script, value: s.change_value })),
      this.terms.denomination,
      outputCount(this.terms),
    );
  }

  private async reviewContext(): Promise<Review> {
    const coins = this.state.seats.flatMap(s => s.coins),
      chain = await this.env.observe(coins);
    // Recheck chain and ownership immediately before approving any signature operation.
    const seats = this.state.seats.map(s => ({ ...s, coin: s.coins[0] }));
    validateRoster({ type: 'roster', seq: this.state.sequence + 1, seats }, this.terms, {
      previousSeq: this.state.sequence,
      ownSeat: this.ownSeat(),
      walletOutpoints: this.env.walletOutpoints(),
      chain,
      now: this.env.now(),
    });
    return {
      mine: this.seat.coins,
      mixScript: this.mixScripts[0],
      mixScripts: this.mixScripts,
      changeScript: this.seat.change_script || undefined,
      maxFee: this.maxFee,
      feeRate: this.terms.fee_rate,
      seatInputs: this.state.seats.map(s => s.coins.length),
      verified: chain,
    };
  }

  async signApproved(commitment: string, signer: (p: Plan, mine: Seat['coins']) => Promise<Map<string, string>>): Promise<void> {
    return this.exclusive(async () => {
      this.require(['review']);
      const p = this.buildPlan();
      const checked = await this.round.review(p, await this.reviewContext(), this.env.now());
      if (checked.commitment !== commitment) throw new Error('Displayed review changed');
      await this.round.approve(commitment, this.env.now());
      await this.round.beforeSigning(commitment, this.env.now());
      // Persist both journals before invoking spending-key code. Any failure leaves reservations locked.
      await this.save({ ...this.state, phase: 'signed' });
      const signatures = await signer(p, this.seat.coins);
      if (signatures.size !== this.seat.coins.length) throw new Error('Missing own signature');
      for (const coin of this.seat.coins) {
        const id = outpoint(coin),
          sig = signatures.get(id),
          index = p.coins.findIndex(c => outpoint(c) === id);
        if (!sig || !verifySignature(p, index, sig)) throw new Error('Invalid own signature');
      }
      await this.save({
        ...this.state,
        signatures: {
          ...this.state.signatures,
          ...Object.fromEntries(signatures),
        },
      });
      for (const [id, sig] of signatures) await this.publish({ type: 'sig', outpoint: id, sig });
    });
  }

  reviewSummary(): { count: number; amount: number; total: number; change: number } | undefined {
    if (!['review', 'signed'].includes(this.state.phase) || !this.round.snapshot().commitment) return undefined;
    const count = outputCount(this.terms);
    return {
      count,
      amount: this.terms.denomination,
      total: count * this.terms.denomination,
      change: this.seat.change_value,
    };
  }

  reviewed(): Journal {
    return this.round.snapshot();
  }

  completedTransaction(): string {
    this.require(['signed']);
    return assemble(this.buildPlan(), new Map(Object.entries(this.state.signatures)));
  }

  async cancel(): Promise<void> {
    // The client closes the relay first. Let the active action settle before
    // deciding whether its coins are unsigned or must remain reserved. A handler
    // already waiting on that action may acquire the session first, so recheck.
    while (this.busy) await this.idle;
    return this.exclusive(async () => {
      await this.round.cancel();
      await this.save({ ...this.state, phase: 'aborted' });
      this.pendingInitialVote = undefined;
      this.inbox.close();
      this.joinSecret.fill(0);
    });
  }
}
