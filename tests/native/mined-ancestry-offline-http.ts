// Only the disposable simulator bundle resolves its evidence transport here.
import { crypto } from 'bitcoinjs-lib';
import { fixture } from '../helpers/mined-ancestry-fixture';
import { SEPARATION_ANCHOR, SEPARATION_EVIDENCE, validateSeparationRequest } from '../../class/xbt/separation-http-policy';

const f = fixture(975000, true);
const { height, tipHeight, blockHash } = f.anchor;
const serverTime = 2000000000;
const tipHeader = Buffer.alloc(80);
tipHeader.writeUInt32LE(serverTime - 600, 68);
const tip = Buffer.from(crypto.hash256(tipHeader)).reverse().toString('hex');
const coin = f.canonical.getId();
const bodies = new Map([
  ['/block-height/961640', '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00'],
  ['/blocks/tip/height', String(tipHeight)],
  ['/block-height/' + tipHeight, tip], ['/block/' + tip + '/header', tipHeader.toString('hex')],
  ['/block-height/' + height, blockHash], ['/block/' + blockHash + '/header', f.proof.header],
  ['/block/' + blockHash, JSON.stringify({ id: blockHash, height, tx_count: 2 })],
  ['/block/' + blockHash + '/txid/0', coin], ['/tx/' + coin + '/hex', f.canonical.toHex()],
  ['/tx/' + coin + '/merkle-proof', JSON.stringify({ block_height: height, pos: 0, merkle: f.proof.merkle })],
]);
export async function getSeparationHTTPResponse(url: string, limit: number, signal: AbortSignal) {
  validateSeparationRequest(url, limit);
  const base = url.startsWith(SEPARATION_EVIDENCE + '/') ? SEPARATION_EVIDENCE : SEPARATION_ANCHOR;
  const body = bodies.get(url.slice(base.length));
  if (!body || body.length > limit || signal.aborted) throw new Error('Unexpected offline evidence request');
  return { body, serverTime };
}
