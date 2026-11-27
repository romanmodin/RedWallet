import { xbtV2BlockHash } from './block-header-hash';
import { getSeparationHTTPResponse } from './separation-http';
import { hasFreshTipTime } from './separation-freshness';
import { SEPARATION_EVIDENCE as EVIDENCE, SEPARATION_ANCHOR as ANCHOR } from './separation-http-policy';
import { Transaction, crypto } from 'bitcoinjs-lib';
import { verifyFundingConflict, verifyMinedAncestry, verifyTransactionMerklePath, verifyXbtRewardForSpend } from './separation-proof';
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

function chainEvidence(requestLimit: number, assertAuthorized: () => void) {
  // Collection has an elapsed-time budget independent of the phone’s wall clock.
  const deadline = performance.now() + 45000;
  let requests = 0;
  let bytes = 0;
  const request = async (host: string, path: string, limit = 16384) => {
    assertAuthorized();
    if (++requests > requestLimit || performance.now() >= deadline) unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(8000, deadline - performance.now()));
    try {
      const response = await getSeparationHTTPResponse(host + path, limit, controller.signal);
      const text = response.body.trim();
      bytes += text.length;
      assertAuthorized();
      if (text.length > limit || bytes > 16000000 || performance.now() >= deadline) unavailable();
      return { body: text, serverTime: response.serverTime };
    } finally {
      clearTimeout(timer);
    }
  };
  const get = async (host: string, path: string, limit = 16384): Promise<string> => (await request(host, path, limit)).body;
  const json = async (path: string): Promise<any> => JSON.parse(await get(EVIDENCE, path));
  const agreedHashAt = async (height: number) => {
    const [hash, anchor] = await Promise.all([get(EVIDENCE, '/block-height/' + height), get(ANCHOR, '/block-height/' + height)]);
    if (!HASH.test(hash) || hash !== anchor) unavailable();
    return hash;
  };
  const tip = async () => {
    const values = await Promise.all([request(EVIDENCE, '/blocks/tip/height'), request(ANCHOR, '/blocks/tip/height')]);
    if (values.some((value) => !/^\d{1,9}$/.test(value.body))) unavailable();
    const heights = values.map((value) => Number(value.body));
    if (Math.min(...heights) < CHECKPOINT_HEIGHT || Math.abs(heights[0] - heights[1]) > 2) unavailable();
    const height = Math.min(...heights);
    const hash = await agreedHashAt(height);
    const header = await get(EVIDENCE, '/block/' + hash + '/header', 160);
    if (
      !/^[0-9a-f]{160}$/i.test(header) ||
      !hasFreshTipTime(
        header,
        values.map((value) => value.serverTime),
      )
    )
      unavailable();
    const computedHash = Buffer.from(crypto.hash256(Buffer.from(header, 'hex')))
      .reverse()
      .toString('hex');
    if (computedHash !== hash) unavailable();
    return height;
  };
  return { get, json, agreedHashAt, tip, deadline };
}

export async function verifyPublicFundingSeparation(funding: Transaction[], assertAuthorized: () => void): Promise<void> {
  assertAuthorized();
  if (!funding.length || funding.length > 64) unavailable();
  // Validate the complete bounded batch before any network request. Budget for
  // every candidate input, proof/metadata lookups and the final anchor recheck;
  // a fixed 128-call limit incorrectly rejected valid larger coin selections.
  if (funding.some((parent) => parent.isCoinbase() || !parent.ins.length || parent.ins.length > 64)) unavailable();
  // Two checkpoint reads and five requests for each of the opening and closing tip checks.
  const requestLimit = 12 + funding.reduce((total, parent) => total + parent.ins.length + 9, 0);
  const { get, json, agreedHashAt, tip } = chainEvidence(requestLimit, assertAuthorized);
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
      const blocks = blockViews.map((value) => JSON.parse(value));
      if (
        blocks.some(
          (block) =>
            block.id !== blockHash || block.height !== height || !Number.isSafeInteger(block.tx_count) || block.tx_count < 2 || block.tx_count > 1000000,
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


// Public queries disclose only SHA-256 block data and its own mining reward.
// The XBT outpoint and its raw ancestry stay on the device.
export async function verifyPublicMinedSeparation(
  selected: { txid: string; vout: number },
  ancestry: readonly string[],
  height: number,
  xbtReward: {
    anchor: Omit<Parameters<typeof verifyXbtRewardForSpend>[2], 'tipHeight'>;
    merkle: readonly string[];
    descendants: readonly string[];
    selectedInclusion?: { height: number; position: number; merkle: readonly string[] };
  },
  // This reader must independently authenticate the current XBT chain tip.
  // Never derive its result from the supplied headers or their provider.
  readTrustedXbtTip: (signal: AbortSignal) => Promise<{ height: number; hash: string }>,
  assertAuthorized: () => void,
): Promise<void> {
  assertAuthorized();
  if (!Number.isSafeInteger(height) || height < CHECKPOINT_HEIGHT || height > 999999999) unavailable();
  const { get, json, agreedHashAt, tip, deadline } = chainEvidence(22, assertAuthorized);
  const readCurrentTip = async () => {
    assertAuthorized();
    const now = performance.now();
    if (now >= deadline) return unavailable();
    const stopAt = Math.min(deadline, now + 8000);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Coin separation could not be verified before the tip read timed out.'));
        controller.abort();
      }, stopAt - now);
    });
    try {
      const current = await Promise.race([readTrustedXbtTip(controller.signal), timeout]);
      assertAuthorized();
      if (performance.now() >= stopAt) return unavailable();
      return current;
    } finally {
      clearTimeout(timer);
    }
  };
  if ((await agreedHashAt(CHECKPOINT_HEIGHT)) !== CHECKPOINT_HASH) unavailable();
  const tipHeight = await tip();
  if (tipHeight - height + 1 < 6) unavailable();
  const blockHash = await agreedHashAt(height);
  const endpoint = '/block/' + blockHash;
  const [id, header, evidenceBlock, anchorBlock] = await Promise.all([
    get(EVIDENCE, endpoint + '/txid/0', 64), get(EVIDENCE, endpoint + '/header', 160),
    json(endpoint), get(ANCHOR, endpoint).then(value => JSON.parse(value)),
  ]);
  if (!HASH.test(id) || [evidenceBlock, anchorBlock].some(block => block?.id !== blockHash || block.height !== height) ||
    evidenceBlock.tx_count !== anchorBlock.tx_count) unavailable();
  const [rawTransaction, branch] = await Promise.all([get(EVIDENCE, '/tx/' + id + '/hex', 2000000), json('/tx/' + id + '/merkle-proof')]);
  parseVerifiedParentTransaction(id, rawTransaction);
  if (branch?.block_height !== height || branch.pos !== 0) unavailable();
  const reward = verifyMinedAncestry(selected, ancestry, {rawTransaction, header, position: branch.pos, merkle: branch.merkle},
    {height, tipHeight, blockHash, txCount: evidenceBlock.tx_count});
  const selectedTx = Transaction.fromHex(ancestry[0]);
  const directReward = selectedTx.getId() === reward.getId();
  const inclusion = directReward ? undefined : xbtReward.selectedInclusion;
  if (!directReward && !inclusion) return unavailable();
  const selectedHeight = inclusion?.height ?? height;
  if (inclusion && (
    !Number.isSafeInteger(inclusion.height) || inclusion.height <= height ||
    !Number.isSafeInteger(inclusion.position) || inclusion.position < 1 || !Array.isArray(inclusion.merkle)
  )) return unavailable();
  const trustedTip = await readCurrentTip();
  const { descendants, anchor } = xbtReward;
  const firstSpendHeight = verifyXbtRewardForSpend(reward, xbtReward.merkle, { ...anchor, tipHeight: trustedTip.height });
  if (inclusion && selectedHeight < firstSpendHeight) unavailable();
  if (descendants.length !== trustedTip.height - height || trustedTip.height - selectedHeight + 1 < 6) unavailable();
  let previous = anchor.blockHash;
  for (let i = 0; i < descendants.length; i++) {
    if (i % 64 === 0) {
      // Yield during long histories so cancellation and elapsed deadlines can fire.
      await new Promise(resolve => setTimeout(resolve, 0));
      assertAuthorized();
      if (performance.now() >= deadline) unavailable();
    }
    const raw = descendants[i];
    if (!/^[0-9a-f]{328}$/i.test(raw)) unavailable();
    const child = Buffer.from(raw, 'hex');
    if (child.readInt32LE(128) !== height + i + 1 || Buffer.from(child.subarray(4, 36)).reverse().toString('hex') !== previous) unavailable();
    if (inclusion && height + i + 1 === selectedHeight) {
      verifyTransactionMerklePath(selectedTx, child.readUInt16LE(108), inclusion.position, inclusion.merkle, child.subarray(36, 68));
    }
    previous = xbtV2BlockHash(child);
  }
  if (previous !== trustedTip.hash) unavailable();
  if ((await tip()) - height + 1 < 6 || (await agreedHashAt(height)) !== blockHash) unavailable();
  const currentTip = await readCurrentTip();
  if (currentTip.height !== trustedTip.height || currentTip.hash !== previous) unavailable();
  assertAuthorized();
}
