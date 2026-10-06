import { element } from 'detox';
import { dismissMnemonicKeyboard } from '../e2e/helperz';

jest.mock('detox', () => ({ element: jest.fn() }));

const unitExpect = expect;
const savedGlobals = { device: global.device, by: global.by, waitFor: global.waitFor, expect: global.expect };
let doneTap;
let keyboardAbsent;
let importVisible;

beforeEach(() => {
  jest.useFakeTimers();
  doneTap = jest.fn().mockRejectedValue(new Error('No Done accessory'));
  keyboardAbsent = jest.fn().mockResolvedValue(undefined);
  importVisible = jest.fn().mockResolvedValue(undefined);
  global.device = { getPlatform: () => 'ios' };
  global.by = { text: value => value, type: value => value, id: value => value };
  element.mockImplementation(target => ({ target, tap: doneTap }));
  global.expect = control => ({
    not: { toBeVisible: keyboardAbsent },
    toBeVisible: () => {
      if (control.target !== 'DoImport') throw new Error('Unexpected control');
      return importVisible();
    },
  });
  global.waitFor = () => ({ toBeVisible: () => ({ withTimeout: importVisible }) });
});

afterEach(() => {
  Object.assign(global, savedGlobals);
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('dismisses an open keyboard using the real Done tap', async () => {
  doneTap.mockResolvedValue(undefined);
  await dismissMnemonicKeyboard();
  unitExpect(doneTap).toHaveBeenCalledTimes(1);
  unitExpect(keyboardAbsent).not.toHaveBeenCalled();
  unitExpect(importVisible).toHaveBeenCalledTimes(1);
});

test('accepts a closed keyboard only when Import is visible', async () => {
  await dismissMnemonicKeyboard();
  unitExpect(keyboardAbsent).toHaveBeenCalledTimes(1);
  unitExpect(importVisible).toHaveBeenCalledTimes(2);
  unitExpect(element.mock.calls.some(([target]) => target === 'MnemonicInput')).toBe(false);
});

test('rejects an open keyboard when Done cannot be tapped', async () => {
  keyboardAbsent.mockRejectedValue(new Error('Keyboard remains visible'));
  const result = unitExpect(dismissMnemonicKeyboard()).rejects.toThrow('within 10 seconds');
  await jest.advanceTimersByTimeAsync(10000);
  await result;
  unitExpect(importVisible).not.toHaveBeenCalled();
});

test('rejects a closed keyboard if Import remains hidden', async () => {
  importVisible.mockRejectedValue(new Error('Import is hidden'));
  const result = unitExpect(dismissMnemonicKeyboard()).rejects.toThrow('within 10 seconds');
  await jest.advanceTimersByTimeAsync(10000);
  await result;
});

test('leaves Android keyboard handling unchanged', async () => {
  global.device = { getPlatform: () => 'android' };
  await dismissMnemonicKeyboard();
  unitExpect(element).not.toHaveBeenCalled();
});
