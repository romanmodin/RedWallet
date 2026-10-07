import { element } from 'detox';
import { waitForEncryptionEnabled } from '../e2e/helperz';

jest.mock('detox', () => ({ element: jest.fn() }));

const savedGlobals = {
  device: global.device,
  by: global.by,
  waitFor: global.waitFor,
};

let platform;
let dismissed;
let visible;

beforeEach(() => {
  platform = 'ios';
  dismissed = jest.fn().mockResolvedValue(undefined);
  visible = jest.fn().mockResolvedValue(undefined);
  global.device = { getPlatform: () => platform };
  global.by = { id: value => value };
  element.mockImplementation(value => value);
  global.waitFor = target => ({
    not: {
      toExist: () => ({
        withTimeout: timeout => dismissed(target, timeout),
      }),
    },
    toBeVisible: () => ({
      withTimeout: timeout => visible(target, timeout),
    }),
  });
});

afterEach(() => {
  Object.assign(global, savedGlobals);
  jest.clearAllMocks();
});

test('iOS accepts the visible secured destination despite a stale secure field', async () => {
  await waitForEncryptionEnabled(5000);
  expect(dismissed).not.toHaveBeenCalled();
  expect(visible).toHaveBeenCalledWith('PlausibleDeniabilityButton', 5000);
});

test('Android proves both secure-field dismissal and secured destination', async () => {
  platform = 'android';
  await waitForEncryptionEnabled(5000);
  expect(dismissed).toHaveBeenCalledWith('ConfirmPasswordInput', 5000);
  expect(visible).toHaveBeenCalledWith('PlausibleDeniabilityButton', 5000);
});
