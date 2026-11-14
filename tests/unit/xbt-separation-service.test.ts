import { Transaction, crypto } from 'bitcoinjs-lib';
import { verifyPublicFundingSeparation } from '../../class/xbt/separation-service';
const checkpoint = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';
const originalFetch = global.fetch;
function fixture() {
  const parent = new Transaction();
  parent.addInput(Buffer.alloc(32, 1), 0);
  parent.addOutput(Buffer.from('0014' + '02'.repeat(20), 'hex'), 1000n);
  const conflict = parent.clone();
  conflict.outs[0].value = 900n;
  const header = Buffer.alloc(80);
  const sibling = Buffer.alloc(32, 3);
  Buffer.from(crypto.hash256(Buffer.concat([sibling, conflict.getHash()]))).copy(header, 36);
  const hash = Buffer.from(crypto.hash256(header)).reverse().toString('hex');
  const spent = { spent: true, txid: conflict.getId(), status: { confirmed: true, block_height: 1000000, block_hash: hash } };
  const calls: string[] = [];
  let rewrite = (_url: string, value: string) => value;
  global.fetch = jest.fn(async (url: any, options: any) => {
    calls.push(url);
    expect(options.method).toBe('GET');
    expect(options.credentials).toBe('omit');
    let value: string;
    if (url.endsWith('/block-height/961640')) value = checkpoint;
    else if (url.endsWith('/blocks/tip/height')) value = '1000005';
    else if (url.includes('/outspend/')) value = JSON.stringify(spent);
    else if (url.endsWith('/hex')) value = conflict.toHex();
    else if (url.endsWith('/merkle-proof'))
      value = JSON.stringify({ block_height: 1000000, pos: 1, merkle: [Buffer.from(sibling).reverse().toString('hex')] });
    else if (url.endsWith('/header')) value = header.toString('hex');
    else if (url.endsWith('/block-height/1000000')) value = hash;
    else if (url.endsWith('/block/' + hash)) value = JSON.stringify({ id: hash, height: 1000000, tx_count: 2 });
    else throw new Error('Unexpected URL');
    return { ok: true, redirected: false, url, headers: { get: () => null }, text: async () => rewrite(url, value) } as any;
  });
  return {
    parent,
    conflict,
    spent,
    hash,
    calls,
    rewrite: (fn: typeof rewrite) => {
      rewrite = fn;
    },
  };
}
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});
it('checks complete proof against both current chain views and rechecks anchors', async () => {
  const f = fixture();
  await verifyPublicFundingSeparation([f.parent], () => {});
  expect(f.calls.filter(url => url.includes('mempool.space') && url.endsWith('/block-height/1000000'))).toHaveLength(2);
  expect(f.calls.every(url => !url.includes('/address/') && !url.includes('xpub') && !url.includes('psbt'))).toBe(true);
});
it('blocks absent or mempool conflicts rather than treating absence as protection', async () => {
  const f = fixture();
  f.spent.spent = false;
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
  f.spent.spent = true;
  f.spent.status.confirmed = false;
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
it('blocks the same body even when the source labels it spent', async () => {
  const f = fixture();
  f.spent.txid = f.parent.getId();
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
it('rejects a wrong chain before any transaction lookup', async () => {
  const f = fixture();
  f.rewrite((url, value) => (url.endsWith('/961640') ? 'ff'.repeat(32) : value));
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
  expect(f.calls.some(url => url.includes('/tx/'))).toBe(false);
});
it('rejects a disagreement between independent block hashes', async () => {
  const f = fixture();
  f.rewrite((url, value) => (url.includes('mempool.space') && url.endsWith('/1000000') ? 'ff'.repeat(32) : value));
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
it('detects a reorg during proof collection', async () => {
  const f = fixture();
  let seen = 0;
  f.rewrite((url, value) => (url.includes('mempool.space') && url.endsWith('/1000000') && ++seen > 1 ? 'ff'.repeat(32) : value));
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
it.each(['1000004', '999999', '1000005.5', 'NaN'])('rejects insufficient or malformed tip %s', tip => {
  const f = fixture();
  f.rewrite((url, value) => (url.endsWith('/blocks/tip/height') ? tip : value));
  return expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
it('rejects mismatched raw transactions and malformed proofs', async () => {
  const f = fixture();
  f.rewrite((url, value) => (url.endsWith('/hex') ? f.parent.toHex() : value));
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
  f.rewrite((url, value) => (url.endsWith('/merkle-proof') ? '{"block_height":1000001}' : value));
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
it('checks every funding transaction, not just the first', async () => {
  const f = fixture();
  const unrelated = f.parent.clone();
  unrelated.ins[0].index = 2;
  await expect(verifyPublicFundingSeparation([f.parent, unrelated], () => {})).rejects.toThrow();
});
it('stops new requests when the signing review is canceled', async () => {
  const f = fixture();
  await expect(
    verifyPublicFundingSeparation([f.parent], () => {
      if (f.calls.length > 1) throw new Error('canceled');
    }),
  ).rejects.toThrow('canceled');
  expect(f.calls.length).toBeLessThanOrEqual(2);
});
it('fails closed on an unavailable provider', async () => {
  fixture();
  global.fetch = jest.fn(async () => {
    throw new Error('offline');
  });
  await expect(verifyPublicFundingSeparation([new Transaction()], () => {})).rejects.toThrow('offline');
});
it('bounds input counts before making requests', async () => {
  const f = fixture();
  await expect(verifyPublicFundingSeparation(Array(65).fill(f.parent), () => {})).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});

it('rejects independently reported tree-size disagreement', async () => {
  const f = fixture();
  f.rewrite((url, value) =>
    url.includes('mempool.space') && url.endsWith('/block/' + f.hash)
      ? JSON.stringify({ id: f.hash, height: 1000000, tx_count: 9 })
      : value,
  );
  await expect(verifyPublicFundingSeparation([f.parent], () => {})).rejects.toThrow();
});
