import { SpvChainLookup, ElectrumRpc } from '../../class/joinblaket/chain';
import headers from '../fixtures/joinblaket/block-headers.json';
const v = headers.vectors.find(x => x.height === 980000)!;
const raw =
  '02000000000101aa9f17840f731547b59b20a0910a23feea21cc41a264a9c90c7ddd80d8ad301710000000000000000002061900000000000017a9148d1990e4ddb45c80b8ae6d48c7514199d2b82064879d0f0000000000001600149e76b0fabb55eb8330f63c453076bff3f6fda8ce0247304402202a1a52b0c8b73b80e6c61c621c2460f6a012418c98431c2b57303cd933f6090902206b27ed9a82b9a56f39e426bc3a9accb159f795be118a2ed39254fa28f08b2b1a0121033d1d9b0b1d18931997ab3be3a36a829a1ae4278b376b2eb28646501c74621ec000000000';
const spk = 'a9148d1990e4ddb45c80b8ae6d48c7514199d2b8206487';
function setup(overrides: Record<string, unknown> = {}, anchorHash = v.hash) {
  const replies: Record<string, unknown> = {
    'blockchain.headers.subscribe': { height: v.height, hex: v.header },
    'blockchain.transaction.get': raw,
    'blockchain.scripthash.listunspent': [{ tx_hash: v.txid, tx_pos: 0, height: v.height, value: 6406 }],
    'blockchain.block.header': v.header,
    'blockchain.transaction.get_merkle': { block_height: v.height, merkle: v.branch, pos: v.pos },
    ...overrides,
  };
  const rpc = jest.fn(async (method: string) => replies[method]);
  const hashAt = jest.fn(async () => anchorHash);
  return { lookup: new SpvChainLookup(rpc as ElectrumRpc, { height: v.height, hash: v.hash, hashAt }), rpc, hashAt };
}
test('proves public Knots transaction bytes and inclusion, keeping server unspent trust explicit', async () => {
  const { lookup, rpc, hashAt } = setup();
  expect(await lookup.height()).toBe(v.height);
  const u = await lookup.utxo(v.txid, 0, spk);
  expect(u).toEqual({
    txid: v.txid,
    vout: 0,
    value: 6406,
    scriptPubKey: spk,
    height: v.height,
    confirmations: 1,
    blockTime: v.time,
    blockHash: v.hash,
    confirmationProof: 'anchored-merkle-pow',
    unspentSource: 'electrum',
  });
  expect(Object.isFrozen(u)).toBe(true);
  expect(hashAt).toHaveBeenCalledWith(v.height);
  expect(rpc).toHaveBeenCalledWith('blockchain.transaction.get', [v.txid, false]);
});
test('absent outputs, wrong scripts and unlisted outputs are not spendable', async () => {
  expect(await setup().lookup.utxo(v.txid, 2, spk)).toBeNull();
  expect(await setup().lookup.utxo(v.txid, 0, '0014' + '00'.repeat(20))).toBeNull();
  expect(await setup({ 'blockchain.scripthash.listunspent': [] }).lookup.utxo(v.txid, 0)).toBeNull();
});
test.each([
  ['blockchain.transaction.get', raw.replace('06190000', '07190000')],
  ['blockchain.transaction.get', raw + '00'],
  ['blockchain.scripthash.listunspent', [{ tx_hash: v.txid, tx_pos: 0, height: 0, value: 6406 }]],
  ['blockchain.scripthash.listunspent', [{ tx_hash: v.txid, tx_pos: 0, height: v.height + 1, value: 6406 }]],
  ['blockchain.scripthash.listunspent', [{ tx_hash: v.txid, tx_pos: 0, height: v.height, value: 6407 }]],
  ['blockchain.scripthash.listunspent', Array(2).fill({ tx_hash: v.txid, tx_pos: 0, height: v.height, value: 6406 })],
  ['blockchain.transaction.get_merkle', { block_height: v.height + 1, merkle: v.branch, pos: v.pos }],
  ['blockchain.transaction.get_merkle', { block_height: v.height, merkle: v.branch, pos: v.pos + 8 }],
  ['blockchain.transaction.get_merkle', { block_height: v.height, merkle: ['aa'.repeat(32)], pos: 0 }],
  ['blockchain.block.header', headers.vectors[1].header],
])('rejects a false or malformed %s response', async (method, reply) => {
  await expect(setup({ [method as string]: reply }).lookup.utxo(v.txid, 0, spk)).rejects.toThrow();
});
test('PoW alone is insufficient without an independent matching chain anchor', async () => {
  await expect(setup({}, 'aa'.repeat(32)).lookup.utxo(v.txid, 0)).rejects.toThrow('Unanchored');
  await expect(setup({ 'blockchain.headers.subscribe': { height: v.height + 1, hex: v.header } }).lookup.height()).rejects.toThrow('tip');
});
test('rechecks the anchored tip after the proof, rejecting a view change', async () => {
  const { lookup, rpc } = setup();
  const original = rpc.getMockImplementation()!;
  let tips = 0;
  rpc.mockImplementation(async method =>
    method === 'blockchain.headers.subscribe' && ++tips === 2 ? { height: v.height + 1, hex: v.header } : original(method),
  );
  await expect(lookup.utxo(v.txid, 0)).rejects.toThrow('tip');
});
