import { Psbt, Transaction, address, payments } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import { UnsupportedFundingSignatures, verifyStandardHardwareFunding } from '../../class/xbt/standard-hardware';
import { signUnifiedP2wpkhInput, finalizeUnifiedP2wpkhInput } from '../../class/xbt/unified-psbt';

const key = ECPairFactory(ecc).fromPrivateKey(Buffer.alloc(32, 11));
const destination = payments.p2wpkh({ pubkey: key.publicKey }).address!;
function spend(parent: Transaction, unified: boolean, split = false): Transaction {
  const psbt = new Psbt();
  psbt.addInput({ hash: parent.getId(), index: 0, witnessUtxo: parent.outs[0], sighashType: unified ? 0x21 : 1 });
  psbt.addOutput({ address: destination, value: parent.outs[0].value - (split ? 2000n : 1000n) });
  if (split) psbt.addOutput({ address: destination, value: 1000n });
  if (unified) {
    signUnifiedP2wpkhInput(psbt, 0, key);
    finalizeUnifiedP2wpkhInput(psbt, 0, key.publicKey, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature));
  } else {
    psbt.signInput(0, key);
    psbt.finalizeAllInputs();
  }
  return psbt.extractTransaction();
}
function fixture(depth = 2, split = false) {
  const ancestor = new Transaction();
  ancestor.addInput(Buffer.alloc(32, 1), 0);
  ancestor.addOutput(address.toOutputScript(destination), 1000000n);
  const root = spend(ancestor, true);
  const chain = [root];
  for (let i = 0; i < depth; i++) chain.push(spend(chain.at(-1)!, false, split && i === depth - 1));
  const parent = chain.at(-1)!;
  const raws: Record<string, string> = Object.fromEntries([ancestor, ...chain].map(tx => [tx.getId(), tx.toHex()]));
  const history = chain.map(tx => ({ tx_hash: tx.getId(), height: 1000000 }));
  const source = {
    raw: jest.fn(async (ids: string[]) => Object.fromEntries(ids.map(id => [id, raws[id]]))),
    history: jest.fn(async () => ({ [destination]: history })),
    tip: jest.fn(async () => 1000009),
    separation: jest.fn(async (_roots: Transaction[]) => {}),
  };
  const coins = [{ txid: parent.getId(), vout: 0, value: Number(parent.outs[0].value), address: destination }];
  return { ancestor, root, chain, parent, raws, history, source, coins };
}

test('spends standard change through multiple generations while proving the original separated root', async () => {
  const f = fixture();
  const proof = await verifyStandardHardwareFunding(f.coins, f.source);
  expect(Object.keys(proof.parents)).toEqual([f.parent.getId()]);
  expect(proof.parents[f.parent.getId()]).toBe(f.parent.toHex());
  expect(f.source.separation).toHaveBeenCalledTimes(1);
  expect(f.source.separation.mock.calls[0][0].map(tx => tx.getId())).toEqual([f.root.getId()]);
  expect(f.source.raw.mock.calls.flat(2).sort()).toEqual(Object.keys(f.raws).sort());
});

test('deduplicates shared ancestry for multiple selected outputs without skipping their exact values', async () => {
  const f = fixture(2, true);
  const coins = [...f.coins, { ...f.coins[0], vout: 1, value: 1000 }];
  await expect(verifyStandardHardwareFunding(coins, f.source)).resolves.toBeDefined();
  expect(f.source.raw.mock.calls.flat(2).sort()).toEqual(Object.keys(f.raws).sort());
  await expect(verifyStandardHardwareFunding([{ ...coins[1], value: 999 }], f.source)).rejects.toThrow('mismatch');
});

test.each([0, 1])('rejects a corrupted signature in ancestry generation %s despite unchanged txids', async index => {
  const f = fixture();
  const changed = f.chain[index].clone();
  changed.ins[0].witness[0][8] = (changed.ins[0].witness[0][8] + 1) % 256;
  expect(changed.getId()).toBe(f.chain[index].getId());
  f.raws[changed.getId()] = changed.toHex();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow(/signature/i);
  expect(f.source.separation).not.toHaveBeenCalled();
});

test('identifies the selected coin even when an older ancestor has an unsupported witness', async () => {
  const f = fixture(2);
  const changed = f.root.clone();
  changed.setWitness(0, []);
  f.raws[changed.getId()] = changed.toHex();
  const error = await verifyStandardHardwareFunding(f.coins, f.source).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnsupportedFundingSignatures);
  if (!(error instanceof UnsupportedFundingSignatures)) throw new Error('Expected an attributed signature-format refusal');
  expect(error.matches(f.coins[0])).toBe(true);
  expect(error.matches({ txid: changed.getId(), vout: 0 })).toBe(false);
  expect(error.matches({ ...f.coins[0], vout: 1 })).toBe(false);
  expect(JSON.stringify(error)).not.toContain(f.coins[0].txid);
});

test('rejects a standard ancestor relabeled as Unified', async () => {
  const f = fixture();
  const changed = f.chain[1].clone();
  changed.ins[0].witness[0][changed.ins[0].witness[0].length - 1] = 0x21;
  f.raws[changed.getId()] = changed.toHex();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow(/signature/i);
});

test('rejects substituted intermediate transaction bodies under the old txid', async () => {
  const f = fixture();
  const changed = f.chain[1].clone();
  changed.outs[0].value -= 1n;
  f.raws[f.chain[1].getId()] = changed.toHex();
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow();
});

test.each([0, 1, 2])('rechecks confirmations for every generation, including generation %s', async index => {
  const f = fixture();
  await verifyStandardHardwareFunding(f.coins, f.source);
  f.history[index].height = 0;
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('six XBT confirmations');
  expect(f.source.separation).toHaveBeenCalledTimes(1);
});

test('requires fresh root separation proof even after successful descendant verification', async () => {
  const f = fixture();
  await verifyStandardHardwareFunding(f.coins, f.source);
  f.source.separation.mockRejectedValueOnce(new Error('separation reorg'));
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('separation reorg');
  expect(f.source.separation).toHaveBeenCalledTimes(2);
});

test('blocks missing ancestors and ordinary funding with no verified Unified root', async () => {
  const f = fixture();
  delete f.raws[f.root.getId()];
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('missing');
  const g = fixture(0);
  const ordinaryRoot = spend(g.ancestor, false);
  g.raws[ordinaryRoot.getId()] = ordinaryRoot.toHex();
  await expect(verifyStandardHardwareFunding([{ ...g.coins[0], txid: ordinaryRoot.getId() }], g.source)).rejects.toThrow();
  expect(g.source.separation).not.toHaveBeenCalled();
});

test('requires every branch of standard funding to be protected', async () => {
  const f = fixture(0);
  const otherAncestor = f.ancestor.clone();
  otherAncestor.ins[0].hash = Buffer.alloc(32, 2);
  const unprotected = spend(otherAncestor, false);
  f.raws[otherAncestor.getId()] = otherAncestor.toHex();
  const request = new Psbt();
  for (const tx of [f.root, unprotected]) request.addInput({ hash: tx.getId(), index: 0, witnessUtxo: tx.outs[0], sighashType: 1 });
  request.addOutput({ address: destination, value: 1997000n });
  request.signAllInputs(key);
  request.finalizeAllInputs();
  const parent = request.extractTransaction();
  f.raws[unprotected.getId()] = unprotected.toHex();
  f.raws[parent.getId()] = parent.toHex();
  await expect(verifyStandardHardwareFunding([{ ...f.coins[0], txid: parent.getId(), value: 1997000 }], f.source)).rejects.toThrow();
});

test('bounds ancestry depth before granting permission or querying external separation evidence', async () => {
  const f = fixture(65);
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('ancestry depth limit');
  expect(f.source.history).not.toHaveBeenCalled();
  expect(f.source.separation).not.toHaveBeenCalled();
});

test('blocks duplicate selections before loading their transactions', async () => {
  const f = fixture();
  await expect(verifyStandardHardwareFunding([...f.coins, ...f.coins], f.source)).rejects.toThrow('duplicate');
  expect(f.source.raw).not.toHaveBeenCalled();
});

test('rejects oversized intermediate raw transactions', async () => {
  const f = fixture();
  f.raws[f.chain[1].getId()] = '00'.repeat(1000001);
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).rejects.toThrow('missing');
  expect(f.source.separation).not.toHaveBeenCalled();
});

test('accepts the maximum supported standard ancestry depth', async () => {
  const f = fixture(64);
  await expect(verifyStandardHardwareFunding(f.coins, f.source)).resolves.toBeDefined();
  expect(f.source.separation.mock.calls[0][0].map(tx => tx.getId())).toEqual([f.root.getId()]);
});

test('rejects a signed but inflationary standard ancestor even if a server claims confirmations', async () => {
  const f = fixture(0);
  const request = new Psbt();
  request.addInput({ hash: f.root.getId(), index: 0, witnessUtxo: f.root.outs[0], sighashType: 1 });
  request.addOutput({ address: destination, value: f.root.outs[0].value + 1n });
  request.signInput(0, key);
  const bad = Transaction.fromBuffer(request.data.globalMap.unsignedTx.toBuffer());
  bad.setWitness(0, [request.data.inputs[0].partialSig![0].signature, key.publicKey]);
  f.raws[bad.getId()] = bad.toHex();
  f.history.push({ tx_hash: bad.getId(), height: 1000000 });
  await expect(
    verifyStandardHardwareFunding([{ ...f.coins[0], txid: bad.getId(), value: Number(bad.outs[0].value) }], f.source),
  ).rejects.toThrow('funding amounts');
});

test('checks both output edges of a shared ancestor in a diamond and fetches each transaction once', async () => {
  const f = fixture(1, true);
  const branch = (index: number) => {
    const p = new Psbt();
    p.addInput({ hash: f.parent.getId(), index, witnessUtxo: f.parent.outs[index], sighashType: 1 });
    p.addOutput({ address: destination, value: f.parent.outs[index].value - 100n });
    p.signInput(0, key);
    p.finalizeAllInputs();
    return p.extractTransaction();
  };
  const left = branch(0),
    right = branch(1);
  const merge = new Psbt();
  for (const tx of [left, right]) merge.addInput({ hash: tx.getId(), index: 0, witnessUtxo: tx.outs[0], sighashType: 1 });
  merge.addOutput({ address: destination, value: left.outs[0].value + right.outs[0].value - 100n });
  merge.signAllInputs(key);
  merge.finalizeAllInputs();
  const parent = merge.extractTransaction();
  for (const tx of [left, right, parent]) {
    f.raws[tx.getId()] = tx.toHex();
    f.history.push({ tx_hash: tx.getId(), height: 1000000 });
  }
  await expect(
    verifyStandardHardwareFunding([{ ...f.coins[0], txid: parent.getId(), value: Number(parent.outs[0].value) }], f.source),
  ).resolves.toBeDefined();
  expect(f.source.raw.mock.calls.flat(2).sort()).toEqual(Object.keys(f.raws).sort());
  expect(f.source.separation.mock.calls[0][0]).toHaveLength(1);
});

test('enforces the depth limit when a deeper path reaches a previously verified ancestor', async () => {
  const f = fixture(64);
  const child = spend(f.parent, false);
  f.raws[child.getId()] = child.toHex();
  f.history.push({ tx_hash: child.getId(), height: 1000000 });
  await expect(
    verifyStandardHardwareFunding([...f.coins, { ...f.coins[0], txid: child.getId(), value: Number(child.outs[0].value) }], f.source),
  ).rejects.toThrow('ancestry depth limit');
  expect(f.source.separation).not.toHaveBeenCalled();
});
