import { element } from 'detox';
import { dismissMnemonicKeyboard } from '../e2e/helperz';

jest.mock('detox', () => ({ element: jest.fn() }));

const unitExpect = expect;
const savedGlobals = {
  device: global.device,
  by: global.by,
  waitFor: global.waitFor,
  expect: global.expect,
};
let doneTap;
let returnKey;
let keyboardAbsent;
let importVisible;
let drag;
let scroll;

beforeEach(() => {
  jest.useFakeTimers();
  doneTap = jest.fn().mockRejectedValue(new Error('No Done accessory'));
  returnKey = jest.fn().mockResolvedValue(undefined);
  keyboardAbsent = jest.fn().mockResolvedValue(undefined);
  importVisible = jest.fn().mockResolvedValue(undefined);
  global.device = { getPlatform: () => 'ios' };
  global.by = {
    text: value => value,
    type: value => value,
    id: value => value,
  };
  drag = jest.fn().mockResolvedValue(undefined);
  scroll = jest.fn().mockResolvedValue(undefined);
  element.mockImplementation(target => ({
    target,
    tap: doneTap,
    tapReturnKey: returnKey,
    swipe: drag,
    scroll,
    scrollTo: jest.fn().mockResolvedValue(undefined),
  }));
  global.expect = control => ({
    not: { toBeVisible: keyboardAbsent },
    toBeVisible: () => {
      if (control.target !== 'DoImport') throw new Error('Unexpected control');
      return importVisible();
    },
  });
  global.waitFor = () => ({
    toBeVisible: () => ({
      withTimeout: importVisible,
      whileElement: () => ({ scroll }),
    }),
  });
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
  unitExpect(element.mock.calls[0][0]).toBe('DismissMnemonicKeyboard');
  unitExpect(keyboardAbsent).toHaveBeenCalledTimes(1);
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
});

test('accepts a closed keyboard only when Import is visible', async () => {
  await dismissMnemonicKeyboard();
  unitExpect(keyboardAbsent).toHaveBeenCalledTimes(1);
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
  unitExpect(returnKey).toHaveBeenCalledTimes(1);
});

test('rejects an open keyboard when Done cannot be tapped', async () => {
  keyboardAbsent.mockRejectedValue(new Error('Keyboard remains visible'));
  const result = unitExpect(dismissMnemonicKeyboard()).rejects.toThrow('within 10 seconds');
  await jest.advanceTimersByTimeAsync(10000);
  await result;
  unitExpect(importVisible).not.toHaveBeenCalled();
});

test('rejects a closed keyboard if Import remains hidden', async () => {
  scroll.mockRejectedValue(new Error('Import is hidden'));
  await unitExpect(dismissMnemonicKeyboard()).rejects.toThrow('Import is hidden');
  unitExpect(returnKey).toHaveBeenCalledTimes(1);
});

test('reveals Android Import without pressing Back or demanding an iOS keyboard', async () => {
  global.device = { getPlatform: () => 'android' };
  await dismissMnemonicKeyboard();
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
  unitExpect(doneTap).not.toHaveBeenCalled();
  unitExpect(keyboardAbsent).not.toHaveBeenCalled();
});

test('propagates Android failure to reveal Import', async () => {
  global.device = { getPlatform: () => 'android' };
  scroll.mockRejectedValue(new Error('Import remains obscured'));
  await unitExpect(dismissMnemonicKeyboard()).rejects.toThrow('Import remains obscured');
});

test('waits for the native Done key to dismiss without dragging the sheet', async () => {
  keyboardAbsent.mockRejectedValueOnce(new Error('Keyboard visible'));
  const pending = dismissMnemonicKeyboard();
  await jest.advanceTimersByTimeAsync(250);
  await pending;
  unitExpect(returnKey).toHaveBeenCalledTimes(1);
  unitExpect(drag).not.toHaveBeenCalled();
  unitExpect(keyboardAbsent).toHaveBeenCalledTimes(2);
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
});

test('falls back to the native Done key when the multiline accessory is absent', async () => {
  doneTap.mockRejectedValueOnce(new Error('No Done accessory')).mockResolvedValue(undefined);
  await dismissMnemonicKeyboard();
  unitExpect(element.mock.calls.some(([target]) => target === 'MnemonicInput')).toBe(true);
  unitExpect(returnKey).toHaveBeenCalledTimes(1);
  unitExpect(drag).not.toHaveBeenCalled();
  unitExpect(keyboardAbsent).toHaveBeenCalledTimes(1);
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
});

test('reveals Import after dismissal by scrolling the actual form', async () => {
  importVisible.mockRejectedValueOnce(new Error('Import below viewport'));
  const pending = dismissMnemonicKeyboard();
  await jest.advanceTimersByTimeAsync(250);
  await pending;
  unitExpect(scroll).toHaveBeenCalledWith(120, 'down', 0.9, 0.5);
  unitExpect(drag).not.toHaveBeenCalled();
});

test('propagates a failed native Done action rather than dragging the sheet', async () => {
  returnKey.mockRejectedValue(new Error('Native Done failed'));
  await unitExpect(dismissMnemonicKeyboard()).rejects.toThrow('Native Done failed');
  unitExpect(drag).not.toHaveBeenCalled();
  unitExpect(importVisible).not.toHaveBeenCalled();
});

test('does not re-tap Done while revealing Import after the keyboard has closed', async () => {
  doneTap.mockResolvedValue(undefined);
  scroll.mockImplementation(async () => {
    // A retained-layout scroll can take longer than the keyboard deadline.
    // It must finish or fail itself, without restarting keyboard dismissal.
    await new Promise(resolve => setTimeout(resolve, 12000));
  });
  const pending = dismissMnemonicKeyboard();
  await jest.advanceTimersByTimeAsync(12000);
  await pending;
  unitExpect(doneTap).toHaveBeenCalledTimes(1);
  unitExpect(returnKey).not.toHaveBeenCalled();
  unitExpect(keyboardAbsent).toHaveBeenCalledTimes(1);
  unitExpect(scroll).toHaveBeenCalledTimes(1);
});
