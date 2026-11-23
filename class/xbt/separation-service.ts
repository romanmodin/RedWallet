import { getSeparationHTTP } from './separation-http';
import { SEPARATION_EVIDENCE as EVIDENCE, SEPARATION_ANCHOR as ANCHOR } from './separation-http-policy';
import { Transaction, crypto } from 'bitcoinjs-lib';
import { verifyFundingConflict } from './separation-proof';
import { parseVerifiedParentTransaction } from './verified-transaction';

// Fixed HTTPS sources; no wallet sessions, xpubs, addresses, PSBTs or broadcast.
// Trust model: two independently operated explorer chain views over TLS, NOT a
// locally validated header chain. A disagreement or outage fails closed.
const CHECKPOINT_HEIGHT = 961640;
const CHECKPOINT_HASH = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';
const HASH = /^[0-9a-f]{64}$/;
const unavailable = (): never => {
  throw new Error('Coin separation could not be verified. Standard signing is blocked.');
};

export async function verifyPublicFundingSeparation(funding: Transaction[], assertAuthorized: () => void): Promise<void> {
  assertAuthorized();
  if (!funding.length || funding.length > 64) unavailable();
  // Validate the complete bounded batch before any network request. Budget for
  // every candidate input, proof/metadata lookups and the final anchor recheck;
  // a fixed 128-call limit incorrectly rejected valid larger coin selections.
  if (funding.some(parent => parent.isCoinbase() || !parent.ins.length || parent.ins.length > 64)) unavailable();
  // Two checkpoint reads and five requests for each of the opening and closing tip checks.
  const requestLimit = 12 + funding.reduce((total, parent) => total + parent.ins.length + 9, 0);
  // Collection has an elapsed-time budget independent of the phone’s wall clock.
  const deadline = performance.now() + 45000;
  let requests = 0;
  let bytes = 0;
  const get = async (host: string, path: string, limit = 16384): Promise<string> => {
    assertAuthorized();
    if (++requests > requestLimit || performance.now() >= deadline) unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(8000, deadline - performance.now()));
    try {
      const text = (await getSeparationHTTP(host + path, limit, controller.signal)).trim();
      bytes += text.length;
      assertAuthorized();
      if (text.length > limit || bytes > 16000000 || performance.now() >= deadline) unavailable();
      return text;
    } finally {
      clearTimeout(timer);
    }
  };
  const json = async (path: string): Promise<any> => JSON.parse(await get(EVIDENCE, path));
  const agreedHashAt = async (height: number) => {
    const [hash, anchor] = await Promise.all([get(EVIDENCE, '/block-height/' + height), get(ANCHOR, '/block-height/' + height)]);
    if (!HASH.test(hash) || hash !== anchor) unavailable();
    return hash;
  };
  const tip = async () => {
    const values = await Promise.all([get(EVIDENCE, '/blocks/tip/height'), get(ANCHOR, '/blocks/tip/height')]);
    if (values.some(value => !/^\d{1,9}$/.test(value))) unavailable();
    const heights = values.map(Number);
    if (Math.min(...heights) < CHECKPOINT_HEIGHT || Math.abs(heights[0] - heights[1]) > 2) unavailable();
    const height = Math.min(...heights);
    const hash = await agreedHashAt(height);
    const header = await get(EVIDENCE, '/block/' + hash + '/header', 160);
    if (!/^[0-9a-f]{160}$/i.test(header)) unavailable();
    const computedHash = Buffer.from(crypto.hash256(Buffer.from(header, 'hex'))).reverse().toString('hex');
    if (computedHash !== hash) unavailable();
    return height;
  };
  if ((await agreedHashAt(CHECKPOINT_HEIGHT)) !== CHECKPOINT_HASH) unavailable();
  const startTip = await tip();
  const anchors = new Map<number, string>();
  for (const parent of funding) {
    let verified = false;
    for (const input of parent.ins) {
      const id = Buffer.from(input.hash).reverse().toString('hex');
      const spent = await json(`/tx/${id}/outspend/${input.index}`);
      if (!spent || typeof spent.spent !== 'boolean') unavailable();
      if (!spent.spent) continue;
      if (!HASH.test(spent.txid) || !spent.status || typeof spent.status.confirmed !== 'boolean') unavailable();
      if (!spent.status.confirmed || spent.txid === parent.getId()) continue;
      const height = spent.status.block_height;
      const blockHash = spent.status.block_hash;
      if (!Number.isSafeInteger(height) || height < CHECKPOINT_HEIGHT || !HASH.test(blockHash)) unavailable();
      if (startTip - height + 1 < 6) continue;
      const [rawTransaction, merkle, header] = await Promise.all([
        get(EVIDENCE, `/tx/${spent.txid}/hex`, 2000000),
        json(`/tx/${spent.txid}/merkle-proof`),
        get(EVIDENCE, `/block/${blockHash}/header`, 160),
      ]);
      parseVerifiedParentTransaction(spent.txid, rawTransaction);
      if (merkle?.block_height !== height) unavailable();
      if ((await agreedHashAt(height)) !== blockHash) unavailable();
      const blockViews = await Promise.all([get(EVIDENCE, `/block/${blockHash}`), get(ANCHOR, `/block/${blockHash}`)]);
      const blocks = blockViews.map(value => JSON.parse(value));
      if (
        blocks.some(
          block =>
            block.id !== blockHash ||
            block.height !== height ||
            !Number.isSafeInteger(block.tx_count) ||
            block.tx_count < 2 ||
            block.tx_count > 1000000,
        ) ||
        blocks[0].tx_count !== blocks[1].tx_count
      )
        unavailable();
      verifyFundingConflict(
        parent,
        { rawTransaction, header, position: merkle.pos, merkle: merkle.merkle },
        { height, blockHash, tipHeight: startTip, txCount: blocks[1].tx_count },
      );
      if (anchors.has(height) && anchors.get(height) !== blockHash) unavailable();
      anchors.set(height, blockHash);
      verified = true;
      break;
    }
    if (!verified) unavailable();
  }
  // No cached permission: re-read the anchoring heights after all proofs, and
  // run this whole service again immediately before the XBT broadcast call.
  const endTip = await tip();
  for (const [height, hash] of anchors) {
    if (endTip - height + 1 < 6) unavailable();
    if ((await agreedHashAt(height)) !== hash) unavailable();
  }
  assertAuthorized();
}
