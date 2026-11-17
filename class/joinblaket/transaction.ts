// Adapted from pinned Kilowallet rc6 TakerTx.kt; see docs/joinblaket-port.md.
import { Transaction, address, networks } from 'bitcoinjs-lib';
import { randomBytes } from '../rng';
import { checkMinerFee, MAKER_DUST, sats, TAKER_DUST } from './fees';
import { SpentCoin, MakerWitness, verifyAllMakerWitnesses, verifyMakerWitness } from './signatures';

export type MakerPart = Readonly<{
  nick: string;
  coins: readonly SpentCoin[];
  paymentAddress: string;
  changeAddress: string;
  makerFee: number;
  miningContribution: number;
}>;
export type BuildRequest = Readonly<{
  coins: readonly SpentCoin[];
  recipient: string;
  changeAddress: string;
  makers: readonly MakerPart[];
  amount: number;
  takerMiningFee: number;
  maxTotalFee: number;
  locktime: number;
}>;
export type UnsignedPayment = Readonly<{
  hex: string;
  txid: string;
  coins: readonly SpentCoin[];
  owners: readonly string[];
  outputOwners: readonly Readonly<{ owner: string; kind: 'cj' | 'change' }>[];
  totalFee: number;
  minerFee: number;
  changeScript: string;
}>;
type Draw = (exclusiveMaximum: number) => Promise<number>;
async function secureDraw(max: number): Promise<number> {
  const ceiling = Math.floor(0x100000000 / max) * max;
  for (let attempt = 0; attempt < 128; attempt++) {
    const n = Buffer.from(await randomBytes(4)).readUInt32LE(0);
    if (n < ceiling) return n % max;
  }
  throw new Error('Secure randomness failed');
}
async function boundedDraw(draw: Draw, max: number): Promise<number> {
  const n = await draw(max);
  if (!Number.isSafeInteger(n) || n < 0 || n >= max) throw new Error('Invalid random draw');
  return n;
}
async function shuffle<T>(items: T[], draw: Draw): Promise<void> {
  for (let i = items.length - 1; i > 0; i--) {
    const j = await boundedDraw(draw, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}
export async function antiFeeSnipingLocktime(height: number, draw: Draw = secureDraw): Promise<number> {
  if (!Number.isSafeInteger(height) || height < 0 || height > 0xffffffff) throw new Error('Invalid chain height');
  if (!height) return 0;
  return (await boundedDraw(draw, 10)) === 0 ? Math.max(1, height - (await boundedDraw(draw, 100))) : height;
}
function outputScript(text: string): string {
  if (typeof text !== 'string' || text.length > 90) throw new Error('Invalid payment address');
  const script = Buffer.from(address.toOutputScript(text, networks.bitcoin));
  if (script.length !== 22 || script[0] !== 0 || script[1] !== 20) throw new Error('JoinBlaket outputs require P2WPKH');
  return script.toString('hex');
}
function coin(value: SpentCoin): SpentCoin {
  if (
    !value ||
    typeof value.txid !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.txid) ||
    !Number.isInteger(value.vout) ||
    value.vout < 0 ||
    value.vout > 0xffffffff ||
    typeof value.scriptPubKey !== 'string' ||
    !/^0014[0-9a-f]{40}$/i.test(value.scriptPubKey) ||
    sats(value.value) === 0
  )
    throw new Error('Invalid JoinBlaket input');
  return Object.freeze({
    txid: value.txid.toLowerCase(),
    vout: value.vout,
    value: value.value,
    scriptPubKey: value.scriptPubKey.toLowerCase(),
  });
}
const sum = (values: readonly number[]) => values.reduce((a, b) => sats(a + sats(b)), 0);

// Inputs must already have authenticated chain evidence and maker ioauth checks.
// This function neither verifies SPV nor authorizes signing. Production uses the
// native CSPRNG; the injected draw exists for deterministic upstream-vector tests.
export async function buildPayment(request: BuildRequest, draw: Draw = secureDraw): Promise<UnsignedPayment> {
  if (
    !request.coins.length ||
    request.coins.length > 128 ||
    !request.makers.length ||
    request.makers.length > 9 ||
    !Number.isSafeInteger(request.locktime) ||
    request.locktime < 0 ||
    request.locktime > 0xffffffff ||
    sats(request.amount) === 0
  )
    throw new Error('Invalid JoinBlaket payment');
  const amount = request.amount,
    locktime = request.locktime;
  const ceiling = sats(request.maxTotalFee);
  const takerMiningFee = sats(request.takerMiningFee);
  const recipientScript = outputScript(request.recipient);
  const changeScript = outputScript(request.changeAddress);
  const takerCoins = request.coins.map(coin);
  const seenMakers = new Set<string>();
  const makers = request.makers.map(m => {
    if (
      typeof m.nick !== 'string' ||
      !/^[a-zA-Z0-9]{1,128}$/.test(m.nick) ||
      m.nick === 'taker' ||
      seenMakers.has(m.nick) ||
      !m.coins.length ||
      m.coins.length > 15
    )
      throw new Error('Invalid or duplicate maker');
    seenMakers.add(m.nick);
    return {
      nick: m.nick,
      coins: m.coins.map(coin),
      payment: outputScript(m.paymentAddress),
      change: outputScript(m.changeAddress),
      fee: sats(m.makerFee),
      contribution: sats(m.miningContribution),
    };
  });
  const inputs = takerCoins.map(c => ({ coin: c, owner: 'taker' }));
  makers.forEach(m => m.coins.forEach(c => inputs.push({ coin: c, owner: m.nick })));
  if (inputs.length > 128 || new Set(inputs.map(i => i.coin.txid + ':' + i.coin.vout)).size !== inputs.length)
    throw new Error('Duplicate or excessive inputs');
  const outputs: {
    script: string;
    value: number;
    owner: string;
    kind: 'cj' | 'change';
  }[] = [];
  const add = (script: string, value: number, owner: string, kind: 'cj' | 'change') =>
    outputs.push({ script, value: sats(value), owner, kind });
  add(recipientScript, amount, 'taker', 'cj');
  makers.forEach(m => add(m.payment, amount, m.nick, 'cj'));
  const makerFees = sum(makers.map(m => m.fee));
  const change = sats(sum(takerCoins.map(c => c.value)) - amount - makerFees - takerMiningFee);
  const dust = change > TAKER_DUST ? 0 : change;
  if (change > TAKER_DUST) add(changeScript, change, 'taker', 'change');
  for (const m of makers) {
    const makerChange = sats(sum(m.coins.map(c => c.value)) - amount - m.contribution + m.fee);
    if (makerChange < MAKER_DUST) throw new Error('Maker change below protocol minimum');
    add(m.change, makerChange, m.nick, 'change');
  }
  // Reused output scripts link participants and can hide output-role mistakes.
  if (new Set(outputs.map(o => o.script)).size !== outputs.length) throw new Error('Duplicate CoinJoin output script');
  const totalFee = sats(makerFees + takerMiningFee + dust);
  if (totalFee > ceiling) throw new Error('Payment exceeds approved total fee ceiling');
  const totalIn = sum(inputs.map(i => i.coin.value)),
    totalOut = sum(outputs.map(o => o.value));
  checkMinerFee(totalIn, totalOut, inputs.length, outputs.length);
  const minerFee = sats(totalIn - totalOut);
  // Copy/validate all untrusted data before the first async boundary.
  await shuffle(inputs, draw);
  await shuffle(outputs, draw);
  const tx = new Transaction();
  tx.version = 2;
  tx.locktime = locktime;
  inputs.forEach(i => tx.addInput(Buffer.from(i.coin.txid, 'hex').reverse(), i.coin.vout, locktime ? 0xfffffffe : 0xffffffff));
  outputs.forEach(o => tx.addOutput(Buffer.from(o.script, 'hex'), BigInt(o.value)));
  return Object.freeze({
    hex: tx.toHex(),
    txid: tx.getId(),
    coins: Object.freeze(inputs.map(i => i.coin)),
    owners: Object.freeze(inputs.map(i => i.owner)),
    outputOwners: Object.freeze(outputs.map(o => Object.freeze({ owner: o.owner, kind: o.kind }))),
    totalFee,
    minerFee,
    changeScript,
  });
}

// No signer is exposed. All signatures (including our own) are validated before
// serialization; callers must separately enforce approval/reservations/SPV.
export function assemblePayment(payment: UnsignedPayment, witnesses: readonly MakerWitness[]): string {
  verifyAllMakerWitnesses(
    payment.hex,
    payment.coins,
    payment.owners,
    witnesses.filter(w => w.maker !== 'taker'),
  );
  if (witnesses.length !== payment.coins.length) throw new Error('Every input needs a signature');
  const tx = Transaction.fromHex(payment.hex);
  const seen = new Set<number>();
  for (const witness of witnesses) {
    if (
      seen.has(witness.index) ||
      payment.owners[witness.index] !== witness.maker ||
      !verifyMakerWitness(payment.hex, payment.coins, witness)
    )
      throw new Error('Invalid, duplicate or misattributed signature');
    seen.add(witness.index);
    tx.setWitness(witness.index, [Buffer.from(witness.signature, 'hex'), Buffer.from(witness.publicKey, 'hex')]);
  }
  if (tx.getId() !== payment.txid) throw new Error('Payment identity changed');
  return tx.toHex();
}
