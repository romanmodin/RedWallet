import { tapAfterTransition } from '../native/tap-after-transition';

const obstruction = new Error('View is not hittable at its visible point.\n- Hit: <UITransitionView: 0x123>');
test('retries a pre-touch transition obstruction and stops at the first successful tap', async () => {
  const tap = jest.fn().mockRejectedValueOnce(obstruction).mockResolvedValue(undefined);
  const pause = jest.fn(async () => {});
  await tapAfterTransition(tap, pause);
  expect(tap).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledWith(250);
});
test.each([
  'Timeout after tap delivery',
  'View is not hittable at its visible point.\n- Hit: <UIScrollView: 0x123>',
  'Multiple elements matched',
])('does not retry ambiguous or unrelated failure: %s', async message => {
  const failure = new Error(message);
  const tap = jest.fn().mockRejectedValue(failure);
  await expect(tapAfterTransition(tap, async () => {})).rejects.toBe(failure);
  expect(tap).toHaveBeenCalledTimes(1);
});
test('persistent obstruction is bounded and preserves the original error', async () => {
  const tap = jest.fn().mockRejectedValue(obstruction);
  await expect(tapAfterTransition(tap, async () => {})).rejects.toBe(obstruction);
  expect(tap).toHaveBeenCalledTimes(20);
});
