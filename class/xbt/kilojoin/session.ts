/** Participant-only v3 controller. Transport and secure persistence are injected.
 * This controller never automatically signs or broadcasts a transaction.
 */
import { script as bitcoinScript } from 'bitcoinjs-lib';
import ecc from '../../../blue_modules/noble_ecc';
import { blind, finalize, prepare, publicKey, RandomBytes } from './blind-rsa';
import { conversationKey, encrypt, hash, hex, NostrEvent, signEvent } from './crypto';
import { MessageInbox } from './messages';
import { changeMessage, memberMac, passwordKey, passwordProof, Terms, tokenHash } from './protocol';
import { ChainCoin, Seat, validateRoster } from './roster';
import { Journal, Round } from './round';
import { assemble, coinScript, isType, outpoint, Plan, plan, Review, verifySignature } from './transaction';

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
  private busy = false;
  private idle: Promise<void> = Promise.resolve();
  constructor(
    terms: Readonly<Terms>,
    seat: Seat,
    joinSecret: Uint8Array,
    private readonly mixScript: string,
    private readonly maxFee: number,
    private readonly round: Round,
    private readonly env: SessionEnvironment,
  ) {
    this.terms = Object.freeze({ ...terms });
    this.seat = JSON.parse(JSON.stringify(seat));
    this.joinSecret = Buffer.from(joinSecret);
    const joinPub = Buffer.from(ecc.pointFromScalar(joinSecret, true)!.slice(1)).toString('hex');
    const journal = round.snapshot();
    if (
      seat.join_pub !== joinPub ||
      !isType(mixScript, terms.script) ||
      !Number.isSafeInteger(maxFee) ||
      maxFee < 0 ||
      journal.poolId !== terms.id ||
      journal.phase !== 'joined' ||
      JSON.stringify([...journal.reserved].sort()) !== JSON.stringify(seat.coins.map(outpoint).sort()) ||
      seat.coins.some(c => coinScript(c).toString('hex') === mixScript) ||
      seat.change_script === mixScript
    )
      throw new Error('Invalid participant configuration');
    this.inbox = new MessageInbox(terms.creator, terms.public_key, joinSecret, env.now());
    this.state = { phase: 'joining', sequence: -1, seats: [], signatures: {}, deadline: journal.deadline };
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
        ...(this.terms.private ? { pw: passwordProof(passwordKey(this.terms.id, password!), this.seat.join_pub) } : {}),
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
    await this.env.saveEncrypted(copy(next));
    this.state = copy(next);
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
          const poolSecret = hex(body.pool_secret as string, 32);
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
          this.inbox.installPoolSecret(poolSecret);
          poolSecret.fill(0);
          break;
        }
        case 'reject':
        case 'abort':
          await this.round.cancel();
          await this.save({ ...this.state, phase: 'aborted' });
          break;
        case 'roster': {
          this.require(['open', 'voting']);
          if (!Number.isSafeInteger(body.seq)) throw new Error('Invalid roster sequence');
          const seats = await this.checkedSeats(body.seats, body.seq as number);
          await this.save({ ...this.state, seats, sequence: body.seq as number });
          break;
        }
        case 'vote_open': {
          this.require(['open']);
          if (this.state.seats.length < this.terms.min_peers || !this.state.seats.some(s => s.token_hash === body.by))
            throw new Error('Invalid vote caller');
          await this.save({
            ...this.state,
            phase: 'voting',
            voteId: identifier(body.vote_id),
            deadline: Math.min(this.state.deadline, message.createdAt + 600),
          });
          break;
        }
        case 'reopen':
          this.require(['voting']);
          if (body.vote_id !== this.state.voteId) throw new Error('Wrong vote');
          await this.save({ ...this.state, phase: 'open', voteId: undefined, deadline: this.round.snapshot().deadline });
          break;
        case 'closing': {
          this.require(['open', 'voting']);
          const roundId = identifier(body.round_id),
            seats = await this.checkedSeats(body.seats, this.state.sequence + 1);
          if (seats.length < this.terms.min_peers) throw new Error('Too few participants');
          const deadline = body.deadline ?? message.createdAt + 300;
          if (!Number.isSafeInteger(deadline) || (deadline as number) <= this.env.now() || (deadline as number) > message.createdAt + 300)
            throw new Error('Invalid closing deadline');
          const prepared = prepare(hex(this.mixScript), this.env.random),
            blinded = blind(publicKey(this.terms.blind_key), prepared, this.env.random);
          await this.save({
            ...this.state,
            phase: 'closing',
            seats,
            roundId,
            deadline: Math.min(deadline as number, this.round.snapshot().deadline),
            prepared: prepared.toString('hex'),
            inverse: blinded.inv.toString(16),
            blinded: blinded.blinded.toString('hex'),
          });
          await this.sendBlind();
          break;
        }
        case 'blind_sig': {
          this.require(['closing']);
          if (body.token_hash !== this.ownSeat().token_hash) return;
          if (body.round_id !== this.state.roundId || this.state.outputSignature) throw new Error('Unexpected blind signature');
          const sig = finalize(
            publicKey(this.terms.blind_key),
            hex(this.state.prepared!),
            hex(body.sig as string),
            BigInt('0x' + this.state.inverse!),
          );
          const entropy = this.env.random(1);
          if (entropy.length !== 1) throw new Error('Invalid entropy');
          await this.save({ ...this.state, outputSignature: sig.toString('hex'), outputNotBefore: this.env.now() + 3 + (entropy[0] % 40) });
          break;
        }
        case 'outputs': {
          this.require(['closing']);
          if (
            !this.state.outputSignature ||
            body.round_id !== this.state.roundId ||
            !Array.isArray(body.scripts) ||
            body.scripts.length !== this.state.seats.length ||
            !body.scripts.every(s => typeof s === 'string' && isType(s, this.terms.script))
          )
            throw new Error('Invalid outputs');
          const outputs = body.scripts as string[],
            next = { ...this.state, outputs };
          const p = this.buildPlan(next),
            expected = await this.reviewContext();
          await this.round.review(p, expected, this.env.now());
          await this.save({ ...next, phase: 'review', deadline: Math.min(this.round.snapshot().deadline, this.env.now() + 1200) });
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
          await this.save({ ...this.state, signatures: { ...this.state.signatures, [body.outpoint as string]: body.sig } });
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
      blinded: this.state.blinded,
      mac: memberMac(this.state.token!, 'blind', this.state.roundId!, hash(hex(this.state.blinded!)).toString('hex')),
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
      await this.publish(
        {
          type: 'output',
          round_id: this.state.roundId,
          script: this.mixScript,
          prefix: this.state.prepared!.slice(0, 64),
          sig: this.state.outputSignature,
        },
        true,
      );
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
      mixScript: this.mixScript,
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
      await this.save({ ...this.state, signatures: { ...this.state.signatures, ...Object.fromEntries(signatures) } });
      for (const [id, sig] of signatures) await this.publish({ type: 'sig', outpoint: id, sig });
    });
  }

  reviewed(): Journal {
    return this.round.snapshot();
  }

  completedTransaction(): string {
    this.require(['signed']);
    return assemble(this.buildPlan(), new Map(Object.entries(this.state.signatures)));
  }

  async cancel(): Promise<void> {
    return this.exclusive(async () => {
      await this.round.cancel();
      await this.save({ ...this.state, phase: 'aborted' });
      this.inbox.close();
      this.joinSecret.fill(0);
    });
  }
}
