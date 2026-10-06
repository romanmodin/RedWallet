import { element } from 'detox';
import { leaveCancelledRecovery } from '../e2e/helperz';

jest.mock('detox', () => ({ element: jest.fn() }));

const unitExpect = expect;
const savedGlobals = {
  device: global.device,
  by: global.by,
  waitFor: global.waitFor,
  expect: global.expect,
};
let screen;
let pendingScreen;
let events;
let closeTap;
let visibleWait;
let hiddenWait;

beforeEach(() => {
  jest.useFakeTimers();
  screen = 'RecoveryResults';
  pendingScreen = null;
  events = [];
  const back = jest.fn(async () => {
    events.push('back:' + screen);
    pendingScreen = screen === 'RecoveryResults' ? 'DoImport' : 'ImportWallet';
  });
  closeTap = jest.fn(async () => {
    events.push('close:' + screen);
    if (screen !== 'ImportWallet') throw new Error('Close tapped before Add Wallet arrived');
    screen = 'home';
  });
  global.device = { getPlatform: () => 'ios', pressBack: back };
  global.by = {
    id: value => value,
    label: value => value,
    text: value => value,
  };
  element.mockImplementation(target => ({
    target,
    atIndex: () => ({
      getAttributes: async () => ({ visible: true, hittable: true }),
      tap: back,
    }),
    tap: closeTap,
  }));
  visibleWait = jest.fn(async target => {
    events.push('wait:' + target);
    if (pendingScreen === target) {
      screen = pendingScreen;
      pendingScreen = null;
    }
    if (screen !== target) throw new Error('Expected screen did not arrive');
  });
  hiddenWait = jest.fn(async target => {
    if (screen === target) throw new Error('Modal still visible');
  });
  global.waitFor = control => ({
    toBeVisible: () => ({ withTimeout: () => visibleWait(control.target) }),
    not: {
      toBeVisible: () => ({ withTimeout: () => hiddenWait(control.target) }),
    },
  });
  global.expect = control => ({
    toBeVisible: async () => {
      if (screen !== control.target) throw new Error('Modal is not visible');
    },
    not: {
      toBeVisible: async () => {
        if (screen === control.target) throw new Error('Modal still visible');
      },
    },
  });
});

afterEach(() => {
  Object.assign(global, savedGlobals);
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('waits for both stack transitions before tapping the real Close control', async () => {
  await leaveCancelledRecovery();
  unitExpect(events).toEqual(['back:RecoveryResults', 'wait:DoImport', 'back:DoImport', 'wait:ImportWallet', 'close:ImportWallet']);
  unitExpect(screen).toBe('home');
  unitExpect(hiddenWait).toHaveBeenCalledWith('ImportWallet');
});

test('retries a lost Close tap only while Add Wallet remains visible', async () => {
  closeTap.mockImplementationOnce(async () => events.push('close ignored'));
  const pending = leaveCancelledRecovery();
  await jest.advanceTimersByTimeAsync(250);
  await pending;
  unitExpect(closeTap).toHaveBeenCalledTimes(2);
  unitExpect(events.filter(x => x.startsWith('back:'))).toHaveLength(2);
  unitExpect(screen).toBe('home');
});

test('does not tap Close when the import form transition fails', async () => {
  visibleWait.mockRejectedValueOnce(new Error('Import form did not arrive'));
  await unitExpect(leaveCancelledRecovery()).rejects.toThrow('Import form did not arrive');
  unitExpect(closeTap).not.toHaveBeenCalled();
  unitExpect(events.filter(x => x.startsWith('back:'))).toHaveLength(1);
});

test('does not tap Close when Add Wallet has not arrived', async () => {
  visibleWait.mockImplementationOnce(async () => {
    screen = 'DoImport';
  });
  visibleWait.mockRejectedValueOnce(new Error('Add Wallet did not arrive'));
  await unitExpect(leaveCancelledRecovery()).rejects.toThrow('Add Wallet did not arrive');
  unitExpect(closeTap).not.toHaveBeenCalled();
});

test('fails within the bound if Close never dismisses the modal', async () => {
  closeTap.mockResolvedValue(undefined);
  const result = unitExpect(leaveCancelledRecovery()).rejects.toThrow('within 15 seconds');
  await jest.advanceTimersByTimeAsync(15000);
  await result;
  unitExpect(screen).toBe('ImportWallet');
  unitExpect(events.filter(x => x.startsWith('back:'))).toHaveLength(2);
});

test('uses Android Back for the native header close and requires modal dismissal', async () => {
  global.device.getPlatform = () => 'android';
  global.device.pressBack.mockImplementationOnce(async () => {
    pendingScreen = 'DoImport';
  });
  global.device.pressBack.mockImplementationOnce(async () => {
    pendingScreen = 'ImportWallet';
  });
  global.device.pressBack.mockImplementationOnce(async () => {
    screen = 'home';
  });
  await leaveCancelledRecovery();
  unitExpect(global.device.pressBack).toHaveBeenCalledTimes(3);
  unitExpect(closeTap).not.toHaveBeenCalled();
  unitExpect(hiddenWait).toHaveBeenCalledWith('ImportWallet');
});
