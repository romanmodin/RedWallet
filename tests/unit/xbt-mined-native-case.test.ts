import { Psbt } from 'bitcoinjs-lib';
import { verifyMinedRequestFunding } from '../../class/xbt/mined-request-funding';
import { syntheticMinedRequest, verifySyntheticOneXbtRequest } from '../native/mined-ancestry-protected-case';
jest.mock('../../class/xbt/separation-http', () => require('../native/mined-ancestry-offline-http'));

test('the simulator fixture accepts the funded request and rejects the replacement tip', async () => {
  await expect(verifySyntheticOneXbtRequest()).resolves.toEqual({
    unsignedOneXbtVerified: true,
    replacedTipRejected: true,
  });
});

test('the remaining path proves the selected outpoint when history omits an unrelated parent', async () => {
  await expect(verifySyntheticOneXbtRequest({ omitSharedParent: true })).resolves.toEqual({
    unsignedOneXbtVerified: true,
    replacedTipRejected: true,
  });
});

test('covers both selected outpoints and reads fresh evidence for each new review', async () => {
  const { request, collect, readTip } = syntheticMinedRequest({
    omitSharedParent: true,
    twoInputs: true,
  });
  const checked = jest.fn(collect);
  const tip = jest.fn(readTip);
  for (let review = 0; review < 2; review++) await verifyMinedRequestFunding(request, checked, tip, () => {});
  expect(checked.mock.calls.map(([point]) => point.vout)).toEqual([0, 1, 0, 1]);
  expect(tip).toHaveBeenCalledTimes(8);
});

test.each(['amount', 'script'])('refuses an incorrect second input %s after validating the first coin', async field => {
  const { request, collect, readTip } = syntheticMinedRequest({
    twoInputs: true,
  });
  const altered = new Psbt();
  request.txInputs.forEach((input, i) => {
    const original = request.data.inputs[i].witnessUtxo!;
    const script = Buffer.from(original.script);
    if (i === 1 && field === 'script') script[script.length - 1] ^= 1;
    const value = original.value + (i === 1 && field === 'amount' ? 1n : 0n);
    altered.addInput({
      hash: input.hash,
      index: input.index,
      witnessUtxo: { script, value },
    });
  });
  request.txOutputs.forEach(output => altered.addOutput(output));
  const tip = jest.fn(readTip);
  await expect(verifyMinedRequestFunding(altered, collect, tip, () => {})).rejects.toThrow('does not match');
  expect(tip).toHaveBeenCalledTimes(2);
});

test('a tip replacement between coins invalidates the whole request', async () => {
  const first = syntheticMinedRequest({ twoInputs: true });
  const next = syntheticMinedRequest({ twoInputs: true, tipNonce: 1 });
  expect(first.request.toBase64()).toBe(next.request.toBase64());
  expect(await first.readTip()).not.toEqual(await next.readTip());
  await verifyMinedRequestFunding(next.request, next.collect, next.readTip, () => {});
  const collect = jest.fn(first.collect).mockImplementationOnce(first.collect).mockImplementationOnce(next.collect);
  const tip = jest.fn(next.readTip).mockImplementationOnce(first.readTip).mockImplementationOnce(first.readTip);
  await expect(verifyMinedRequestFunding(first.request, collect, tip, () => {})).rejects.toThrow(/separation/i);
  expect(tip).toHaveBeenCalledTimes(3);
});

test('a changed recipient list during review invalidates the request', async () => {
  const { request, collect, readTip } = syntheticMinedRequest();
  const changed = async () => {
    request.addOutput({ script: Buffer.from([0x51]), value: 1n });
    return readTip();
  };
  await expect(verifyMinedRequestFunding(request, collect, changed, () => {})).rejects.toThrow('request changed');
});

test.each(['pre-expiry', 'rolling'] as const)(
  'accepts the first mature spend under the %s rule',
  async rewardEra => {
    const { request, collect, readTip } = syntheticMinedRequest({
      rewardEra,
      omitSharedParent: true,
    });
    await verifyMinedRequestFunding(request, collect, readTip, () => {});
  },
  90000,
);

test.each(['pre-expiry', 'rolling'] as const)(
  'rejects an early spend under the %s rule even after the tip matures',
  async rewardEra => {
    const { request, collect, readTip } = syntheticMinedRequest({
      rewardEra,
      earlySpend: true,
    });
    await expect(verifyMinedRequestFunding(request, collect, readTip, () => {})).rejects.toThrow(/separation/i);
  },
  90000,
);
