import ecc from '../../blue_modules/noble_ecc';
import { parseSeat, validateRoster, ChainCoin } from '../../class/xbt/kilojoin/roster';
import { Terms } from '../../class/xbt/kilojoin/protocol';
import { Coin, coinScript, outpoint, ownershipMessage } from '../../class/xbt/kilojoin/transaction';
const terms = {
  v: 3,
  id: '0123456789abcdef',
  script: 'p2wpkh',
  denomination: 10000,
  fee_rate: 2,
  max_inputs: 10,
  max_peers: 5,
} as Terms;
function fixture() {
  const seats = [1, 2].map(n => {
    const key = Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
    const pubkey = Buffer.from(ecc.pointFromScalar(key, true)!).toString('hex');
    const coin: Coin = {
      txid: n.toString(16).repeat(64),
      vout: 0,
      value: 50000,
      pubkey,
      type: 'p2wpkh',
    };
    return {
      token_hash: n.toString(16).repeat(64),
      join_pub: pubkey.slice(2),
      coin,
      change_script: '0014' + n.toString(16).repeat(40),
      change_value: 39729,
      proofs: [Buffer.from(ecc.signDER(ownershipMessage(terms.id, pubkey.slice(2), coin), key)).toString('hex')],
    };
  });
  const ownSeat = parseSeat(seats[0], terms);
  const chain = new Map<string, ChainCoin>(
    seats.map(s => [
      outpoint(s.coin),
      {
        value: s.coin.value,
        script: coinScript(s.coin).toString('hex'),
        unspent: true,
        checkedAt: 10000,
      },
    ]),
  );
  return {
    body: { type: 'roster', seq: 1, seats },
    context: {
      previousSeq: 0,
      ownSeat,
      walletOutpoints: new Set([outpoint(seats[0].coin)]),
      chain,
      now: 10000,
    },
  };
}
describe('Kilojoin roster contents', () => {
  test('accepts proven seats backed by fresh independent chain observations', () => {
    const { body, context } = fixture();
    expect(validateRoster(body, terms, context).seats).toHaveLength(2);
  });
  test('rejects replayed roster sequence', () => {
    const { body, context } = fixture();
    context.previousSeq = 1;
    expect(() => validateRoster(body, terms, context)).toThrow('sequence');
  });
  test.each(['spent', 'stale', 'future', 'value', 'script', 'missing'])('rejects %s chain observation', problem => {
    const { body, context } = fixture();
    const id = outpoint(body.seats[1].coin);
    const known = context.chain.get(id)!;
    if (problem === 'spent') known.unspent = false;
    if (problem === 'stale') known.checkedAt = 9939;
    if (problem === 'future') known.checkedAt = 10001;
    if (problem === 'value') known.value++;
    if (problem === 'script') known.script = context.chain.get(outpoint(body.seats[0].coin))!.script;
    if (problem === 'missing') context.chain.delete(id);
    expect(() => validateRoster(body, terms, context)).toThrow('chain observation');
  });
  test('rejects replaced own change even with correct value', () => {
    const { body, context } = fixture();
    body.seats[0].change_script = '0014' + 'ab'.repeat(20);
    expect(() => validateRoster(body, terms, context)).toThrow('Own seat');
  });
  test('rejects altered amount, invalid proof and excess fees', () => {
    let f = fixture();
    f.body.seats[1].coin.value++;
    expect(() => validateRoster(f.body, terms, f.context)).toThrow('proof');
    f = fixture();
    f.body.seats[1].proofs[0] = f.body.seats[0].proofs[0];
    expect(() => validateRoster(f.body, terms, f.context)).toThrow('proof');
    f = fixture();
    f.body.seats[1].change_value--;
    expect(() => validateRoster(f.body, terms, f.context)).toThrow('change');
  });
  test('rejects duplicate identities and a second seat spending our unselected wallet coin', () => {
    let f = fixture();
    f.body.seats.push(f.body.seats[1]);
    expect(() => validateRoster(f.body, terms, f.context)).toThrow('Duplicate');
    f = fixture();
    f.context.walletOutpoints.add(outpoint(f.body.seats[1].coin));
    expect(() => validateRoster(f.body, terms, f.context)).toThrow('Unselected');
  });
  test('rejects contradictory single/multi-input representation', () => {
    const { body } = fixture();
    expect(() => parseSeat({ ...body.seats[0], coins: [body.seats[1].coin] }, terms)).toThrow('Ambiguous');
  });
});
