// Maker input authorization, adapted from pinned rc6 Session.kt IoauthCheck.
import { address, crypto, networks } from 'bitcoinjs-lib';
import { ChainLookup } from './chain';
import { acceptable, MAKER_DUST, offerFee, sats } from './fees';
import { isCompressedPoint, verifyMessage } from './message-signatures';
import { isValidNick } from './nick';
import { MakerOffer } from './offers';
import { formatRef, parseUtxo } from './podle';
import { IoAuth } from './session-messages';
import { SpentCoin } from './signatures';
import { uint32 } from './spv';
import { MakerPart } from './transaction';

export type IoauthResult =
  | Readonly<{ ok: true; part: MakerPart; authPub: string }>
  | Readonly<{ ok: false; reason: string; unavailable: boolean }>;
const fail = (reason: string, unavailable = false): IoauthResult => Object.freeze({ ok: false, reason, unavailable });
function paymentScript(text: string): string {
  if (typeof text !== 'string' || text.length > 90) throw new Error('Invalid maker address');
  const hex = Buffer.from(address.toOutputScript(text, networks.bitcoin)).toString('hex');
  // Matches current builder policy; wider maker output types remain unsupported.
  if (!/^0014[0-9a-f]{40}$/.test(hex)) throw new Error('Maker outputs require native SegWit');
  return hex;
}
export async function checkIoauth(
  request: Readonly<{
    io: IoAuth;
    makerPublicKey: string;
    offer: MakerOffer;
    amount: number;
    taken: ReadonlySet<string>;
  }>,
  chain: ChainLookup,
): Promise<IoauthResult> {
  let io: IoAuth, offer: MakerOffer, amount: number, publicKey: string, taken: Set<string>, fee: number;
  try {
    amount = sats(request.amount);
    offer = Object.freeze({ ...request.offer });
    if (!amount || !isValidNick(offer.counterparty) || !acceptable(offer, amount)) return fail('Unacceptable maker offer');
    fee = offerFee(offer, amount);
    publicKey = request.makerPublicKey;
    if (typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/.test(publicKey)) return fail('Invalid maker key');
    const input = request.io;
    if (!Array.isArray(input.utxos) || !input.utxos.length || input.utxos.length > 15) return fail('Invalid maker input count');
    io = Object.freeze({ ...input, utxos: Object.freeze(input.utxos.map(x => parseUtxo(formatRef(x, true)))) });
    taken = new Set(request.taken);
    if (
      !/^0[23][0-9a-f]{64}$/.test(io.authPub) ||
      !isCompressedPoint(Buffer.from(io.authPub, 'hex')) ||
      !verifyMessage(publicKey, io.signature, Buffer.from(io.authPub, 'hex'))
    )
      return fail('Maker key authorization failed');
    if (paymentScript(io.paymentAddress) === paymentScript(io.changeAddress)) return fail('Duplicate maker output');
    const keys = io.utxos.map(x => x.txid + ':' + x.vout);
    if (new Set(keys).size !== keys.length) return fail('Duplicate maker input');
    if (keys.some(key => taken.has(key))) return fail('Input already claimed by a participant');
  } catch {
    return fail('Invalid maker authorization');
  }
  let height: number;
  try {
    height = uint32(await chain.height());
  } catch {
    return fail('Chain verification unavailable', true);
  }
  const coins: SpentCoin[] = [];
  for (const ref of io.utxos) {
    let u;
    try {
      u = await chain.utxo(ref.txid, ref.vout);
    } catch {
      return fail('Chain verification unavailable', true);
    }
    if (!u) return fail('Maker output is spent or missing');
    try {
      if (
        u.txid !== ref.txid ||
        u.vout !== ref.vout ||
        u.confirmationProof !== 'anchored-merkle-pow' ||
        u.unspentSource !== 'electrum' ||
        uint32(u.height) === 0 ||
        u.height > height ||
        u.confirmations !== height - u.height + 1 ||
        !/^0014[0-9a-f]{40}$/.test(u.scriptPubKey) ||
        sats(u.value) === 0
      )
        return fail('Maker input is not proven');
      if (
        (ref.scriptPubKeyHex !== undefined && ref.scriptPubKeyHex !== u.scriptPubKey) ||
        (ref.height !== undefined && ref.height !== u.height)
      )
        return fail('Maker input metadata mismatch');
      coins.push(Object.freeze({ txid: ref.txid, vout: ref.vout, value: u.value, scriptPubKey: u.scriptPubKey }));
    } catch {
      return fail('Maker input is not proven');
    }
  }
  try {
    const total = coins.reduce((sum, coin) => sats(sum + coin.value), 0);
    if (sats(total - amount - offer.txfee + fee) < MAKER_DUST) return fail('Maker change below protocol minimum');
  } catch {
    return fail('Invalid maker accounting');
  }
  const authScript = '0014' + Buffer.from(crypto.hash160(Buffer.from(io.authPub, 'hex'))).toString('hex');
  if (!coins.some(c => c.scriptPubKey === authScript)) return fail('Authorization key controls no declared input');
  try {
    if (uint32(await chain.height()) !== height) return fail('Chain view changed', true);
  } catch {
    return fail('Chain verification unavailable', true);
  }
  return Object.freeze({
    ok: true,
    authPub: io.authPub,
    part: Object.freeze({
      nick: offer.counterparty,
      coins: Object.freeze(coins),
      paymentAddress: io.paymentAddress,
      changeAddress: io.changeAddress,
      makerFee: fee,
      miningContribution: offer.txfee,
    }),
  });
}
