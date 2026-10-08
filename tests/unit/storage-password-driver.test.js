import { element } from 'detox';
import { confirmPasswordDialog, waitForId } from '../e2e/helperz';
import { submitStoragePassword } from '../e2e/storage-password';

jest.mock('detox', () => ({ element: jest.fn() }));
jest.mock('../e2e/helperz', () => ({
  confirmPasswordDialog: jest.fn(),
  waitForId: jest.fn(),
}));

const savedGlobals = { device: global.device, by: global.by };
let values;
let focused;

beforeEach(() => {
  values = { PasswordInput: '', ConfirmPasswordInput: '' };
  focused = 'PasswordInput';
  global.device = {
    getPlatform: () => 'ios',
    disableSynchronization: jest.fn(),
    enableSynchronization: jest.fn(),
  };
  global.by = { id: value => value };
  // Model the real secure fields: changing focus clears the newly focused input.
  const focus = id => {
    if (focused !== id) values[id] = '';
    focused = id;
  };
  element.mockImplementation(id => ({
    tap: async () => focus(id),
    replaceText: async text => {
      values[id] = text;
    },
    typeText: async text => {
      focus(id);
      values[id] += text;
    },
    tapReturnKey: async () => {
      focus(id);
      focused = null;
    },
  }));
  waitForId.mockResolvedValue(undefined);
  confirmPasswordDialog.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.assign(global, savedGlobals);
  jest.resetAllMocks();
});

test.each(['ios', 'android'])('%s preserves both secure values when submitting confirmation', async platform => {
  global.device.getPlatform = () => platform;
  confirmPasswordDialog.mockImplementation(async () => {
    expect(values).toEqual({
      PasswordInput: 'fixture-pass',
      ConfirmPasswordInput: 'fixture-pass',
    });
  });
  const settled = jest.fn();
  await submitStoragePassword('fixture-pass', true, settled);
  expect(confirmPasswordDialog).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledTimes(1);
});

test('single-password submission leaves confirmation untouched', async () => {
  await submitStoragePassword('fixture-pass', false, jest.fn());
  expect(values).toEqual({
    PasswordInput: 'fixture-pass',
    ConfirmPasswordInput: '',
  });
  expect(waitForId).not.toHaveBeenCalledWith('ConfirmPasswordInput');
});

test('an uncertain submission error is propagated without retry and restores synchronization', async () => {
  const error = new Error('uncertain tap outcome');
  confirmPasswordDialog.mockRejectedValue(error);
  const settled = jest.fn();
  await expect(submitStoragePassword('fixture-pass', true, settled)).rejects.toBe(error);
  expect(confirmPasswordDialog).toHaveBeenCalledTimes(1);
  expect(settled).not.toHaveBeenCalled();
  expect(device.enableSynchronization).toHaveBeenCalledTimes(1);
});

test('destination failures are propagated and restore synchronization', async () => {
  const error = new Error('destination missing');
  await expect(
    submitStoragePassword('fixture-pass', true, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(device.enableSynchronization).toHaveBeenCalledTimes(1);
});
