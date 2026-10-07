import { element } from 'detox';
import { setCustomFeeRate } from '../e2e/helperz';

jest.mock('detox', () => ({ element: jest.fn() }));

const unitExpect = expect;
const savedGlobals = {
  device: global.device,
  by: global.by,
  waitFor: global.waitFor,
};
const savedCI = process.env.CI;
let controls;
let scroll;

function controlFor(target) {
  if (!controls.has(target)) {
    controls.set(target, {
      target,
      tap: jest.fn().mockResolvedValue(undefined),
      typeText: jest.fn().mockResolvedValue(undefined),
    });
  }
  return controls.get(target);
}

beforeEach(() => {
  controls = new Map();
  scroll = jest.fn().mockResolvedValue(undefined);
  process.env.CI = 'true';
  global.device = { getPlatform: () => 'android' };
  global.by = {
    id: value => value,
  };
  element.mockImplementation(controlFor);
  global.waitFor = () => ({
    toBeVisible: () => ({
      withTimeout: jest.fn().mockResolvedValue(undefined),
      whileElement: container => {
        unitExpect(container).toBe('SelectFeeScroll');
        return { scroll };
      },
    }),
  });
});

afterEach(() => {
  Object.assign(global, savedGlobals);
  if (savedCI === undefined) delete process.env.CI;
  else process.env.CI = savedCI;
  jest.clearAllMocks();
});

test('scrolls the fee form until the focused custom fee input is visible', async () => {
  await setCustomFeeRate(1);

  unitExpect(controlFor('chooseFee').tap).toHaveBeenCalledTimes(1);
  unitExpect(controlFor('feeCustomContainerButton').tap).toHaveBeenCalledTimes(1);
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
  unitExpect(controlFor('feeCustom').typeText).toHaveBeenCalledWith('1\n');
});

test('does not type or submit when the custom fee input cannot be revealed', async () => {
  scroll.mockRejectedValue(new Error('Custom fee input remains obscured'));

  await unitExpect(setCustomFeeRate(1)).rejects.toThrow('Custom fee input remains obscured');
  unitExpect(controlFor('feeCustom').typeText).not.toHaveBeenCalled();
});
