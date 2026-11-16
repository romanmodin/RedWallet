/**
 * Deferred-native-response navigation tests for issue #257.
 *
 * Every native bridge call below is held open by the test. The screen is then
 * left (unmounted, as React Navigation does on Back) and the pending call is
 * resolved or rejected late. These tests only use JS mocks: they can show that
 * the JS layer tolerates late bridge completions, but they cannot establish or
 * exclude a native iOS crash.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, NativeModules } from 'react-native';
import { LndWallet } from '../../class/wallets/lnd-wallet';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const flush = () => act(async () => {});

const mockStorage: { wallets: unknown[]; saveToDisk: jest.Mock } = { wallets: [], saveToDisk: jest.fn(async () => {}) };
jest.mock('../../hooks/context/useStorage', () => ({ useStorage: () => mockStorage }));
jest.mock('../../hooks/usePaymentAuthorization', () => ({ usePaymentAuthorization: () => async () => true }));
jest.mock('../../hooks/useSecretExport', () => ({ useSecretExport: () => async () => true }));
const mockNavigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
  isFocused: jest.fn(() => true),
  addListener: jest.fn((_event: string, _listener: () => void) => jest.fn()),
};
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: () => mockNavigation }));
jest.mock('../../hooks/context/useSettings', () => ({ useSettings: () => ({ xbtPriceQuote: null }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  // Mirror real focus semantics: run on mount, clean up on unmount (leaving the screen).
  useFocusEffect: (callback: () => void | (() => void)) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('@react-native-documents/picker', () => ({ types: {} }));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../components/QRCode', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});

const hash = 'a'.repeat(64);
const channel = { point: 'fixture-point:0', peer: 'fixture-peer', active: true, state: 'active', localSats: '82000' };
const tower = { key: '02fixture', addresses: ['tower.onion:9911'], eligible: true, sessions: '0', acknowledged: '0', pending: '0' };
const network = {
  selected: 'direct',
  active: 'direct',
  running: true,
  restartRequired: false,
  status: 'Direct connection',
  defaultTower: '02fixture@tower.onion:9911',
};
const overview = {
  node: '02' + 'a'.repeat(64),
  synced: true,
  peers: '1',
  height: '1',
  activeChannels: '1',
  fundingTotal: '0',
  fundingConfirmed: '0',
  fundingPending: '0',
  fundingLocked: '0',
  anchorReserve: '0',
  lightningLocal: '0',
  lightningRemote: '0',
  channelPending: '0',
  splicePending: '0',
};
const bridge = {
  run: jest.fn<Promise<string>, [string, string]>(),
  peer: jest.fn<Promise<string>, []>(),
  manage: jest.fn<Promise<unknown>, [string, string, string, string]>(),
  network: jest.fn<Promise<unknown>, [string, string]>(),
  watchtower: jest.fn<Promise<unknown>, [string, string]>(),
  wallet: jest.fn<Promise<unknown>, [string, string]>(),
  invoice: jest.fn<Promise<unknown>, string[]>(),
};
NativeModules.XBTLightningBridge = bridge;
const XBTLightning = require('../../screen/settings/XBTLightning').default;
const XBTLightningNetwork = require('../../components/XBTLightningNetwork').default;
const LndWalletHome = require('../../screen/wallets/LndWalletHome').default;

// Anything React logs when a late completion lands on an unmounted tree, plus
// any rejection that nothing handled, is recorded and asserted empty.
let consoleErrors: string[] = [];
let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  jest.useFakeTimers();
  consoleErrors = [];
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
  AppState.currentState = 'active';
  mockStorage.wallets = [];
  mockStorage.saveToDisk = jest.fn(async () => {});
  mockNavigation.isFocused.mockReturnValue(true);
  bridge.run.mockReset().mockResolvedValue('Running');
  bridge.peer.mockReset().mockResolvedValue('');
  bridge.manage.mockReset().mockImplementation(async action => (action === 'channelStatus' ? [] : 'fixture-txid'));
  bridge.network.mockReset().mockResolvedValue(network);
  bridge.watchtower.mockReset().mockResolvedValue([tower]);
  bridge.wallet.mockReset().mockImplementation(async kind => (kind === 'overview' ? overview : { rows: [], next: '0', more: false }));
  bridge.invoice.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  process.off('unhandledRejection', onUnhandled);
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const expectQuiet = async () => {
  await flush();
  expect(consoleErrors).toEqual([]);
  expect(unhandled).toEqual([]);
};

describe('XBTLightning settings: late channel refresh', () => {
  test.each(['resolve', 'reject'] as const)('channelStatus that %ss after leaving the screen is ignored quietly', async outcome => {
    const channels = deferred<unknown>();
    bridge.manage.mockImplementation(async action => (action === 'channelStatus' ? channels.promise : 'fixture-txid'));
    const screen = render(<XBTLightning />);
    await flush();
    expect(bridge.manage).toHaveBeenCalledWith('channelStatus', '', '', '');
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') channels.resolve([channel]);
      else channels.reject(new Error('native channel read failed'));
      await channels.promise.catch(() => {});
    });
    await expectQuiet();
  });

  test('timers and AppState listeners are released on leave; no further bridge reads are issued', async () => {
    const screen = render(<XBTLightning />);
    await flush();
    const before = {
      manage: bridge.manage.mock.calls.length,
      run: bridge.run.mock.calls.length,
    };
    screen.unmount();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(bridge.manage.mock.calls.length).toBe(before.manage);
    expect(bridge.run.mock.calls.length).toBe(before.run);
    expect(jest.getTimerCount()).toBe(0);
    await expectQuiet();
  });

  test('startup status/peer read that settles after leaving does not update state', async () => {
    const status = deferred<string>();
    const peer = deferred<string>();
    bridge.run.mockImplementation(async () => status.promise);
    bridge.peer.mockImplementation(async () => peer.promise);
    const screen = render(<XBTLightning />);
    await flush();
    screen.unmount();
    await act(async () => {
      status.resolve('Running');
      peer.resolve('peer:1');
      await Promise.all([status.promise, peer.promise]);
    });
    await expectQuiet();
  });

  test('startup read that rejects after leaving is swallowed', async () => {
    const status = deferred<string>();
    bridge.run.mockImplementation(async () => status.promise);
    const screen = render(<XBTLightning />);
    await flush();
    screen.unmount();
    await act(async () => {
      status.reject(new Error('native status failed'));
      await status.promise.catch(() => {});
    });
    await expectQuiet();
  });

  test('progress poll in a starting node that settles after leaving schedules no further timer', async () => {
    const progress = deferred<string>();
    bridge.run.mockImplementation(async action => (action === 'progress' ? progress.promise : 'Syncing'));
    const screen = render(<XBTLightning />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(bridge.run).toHaveBeenCalledWith('progress', '');
    screen.unmount();
    await act(async () => {
      progress.resolve('50%');
      await progress.promise;
    });
    expect(jest.getTimerCount()).toBe(0);
    await expectQuiet();
  });
});

describe('XBTLightning settings: late wallet save after channel refresh', () => {
  const lndWallet = () => {
    const wallet = new LndWallet();
    return wallet;
  };

  test.each(['resolve', 'reject'] as const)('saveToDisk that %ss after leaving is ignored quietly', async outcome => {
    const wallet = lndWallet();
    const fetched = deferred<void>();
    const saved = deferred<void>();
    jest.spyOn(wallet, 'fetchBalance').mockImplementation(() => fetched.promise);
    mockStorage.wallets = [wallet];
    mockStorage.saveToDisk = jest.fn(() => saved.promise);
    bridge.manage.mockImplementation(async action => (action === 'channelStatus' ? [channel] : 'fixture-txid'));
    const screen = render(<XBTLightning />);
    await flush();
    await act(async () => {
      fetched.resolve();
      await fetched.promise;
    });
    expect(mockStorage.saveToDisk).toHaveBeenCalledTimes(1);
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') saved.resolve();
      else saved.reject(new Error('disk full'));
      await saved.promise.catch(() => {});
    });
    await expectQuiet();
  });

  test('fetchBalance that rejects after leaving never reaches saveToDisk', async () => {
    const wallet = lndWallet();
    const fetched = deferred<void>();
    jest.spyOn(wallet, 'fetchBalance').mockImplementation(() => fetched.promise);
    mockStorage.wallets = [wallet];
    bridge.manage.mockImplementation(async action => (action === 'channelStatus' ? [channel] : 'fixture-txid'));
    const screen = render(<XBTLightning />);
    await flush();
    screen.unmount();
    await act(async () => {
      fetched.reject(new Error('balance read failed'));
      await fetched.promise.catch(() => {});
    });
    expect(mockStorage.saveToDisk).not.toHaveBeenCalled();
    await expectQuiet();
  });

  // Documents actual behavior: the wallet is still saved after the screen is
  // gone, because only the setState calls are guarded by `mounted`.
  test('characterization: a balance read finishing after leaving still persists the wallet once', async () => {
    const wallet = lndWallet();
    const fetched = deferred<void>();
    jest.spyOn(wallet, 'fetchBalance').mockImplementation(() => fetched.promise);
    mockStorage.wallets = [wallet];
    bridge.manage.mockImplementation(async action => (action === 'channelStatus' ? [channel] : 'fixture-txid'));
    const screen = render(<XBTLightning />);
    await flush();
    screen.unmount();
    await act(async () => {
      fetched.resolve();
      await fetched.promise;
    });
    await flush();
    expect(mockStorage.saveToDisk).toHaveBeenCalledTimes(1);
    await expectQuiet();
  });
});

describe('XBTLightning settings: late payment-status reads', () => {
  const startPendingPayment = async (read: (kind: string, cursor: string) => Promise<unknown>) => {
    const { Alert } = require('react-native');
    const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    bridge.invoice.mockImplementation(async (action: string) =>
      action === 'decode' ? { sats: '500', destination: 'test peer', hash } : new Promise(() => {}),
    );
    bridge.wallet.mockImplementation(read);
    const screen = render(<XBTLightning />);
    await flush();
    fireEvent.changeText(screen.getByLabelText('Invoice to pay'), 'lnbcrt-fixture');
    await act(async () => fireEvent.press(screen.getByText('Review invoice')));
    fireEvent.press(screen.getByText('Pay 500 sats'));
    const buttons = prompt.mock.calls[0][2]!;
    return { screen, approve: buttons.find(button => button.text === 'Pay')!.onPress! };
  };
  const emptyPage = { rows: [], next: '0', more: false };

  test.each(['resolve', 'reject'] as const)('payment history read that %ss after leaving mid-submission is ignored quietly', async outcome => {
    const lookup = deferred<unknown>();
    const { screen, approve } = await startPendingPayment(async () => lookup.promise);
    await act(async () => {
      approve();
    });
    // Payment history lookup is in flight; the payment itself is not yet submitted.
    expect(bridge.wallet).toHaveBeenCalledWith('payments', '0');
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') lookup.resolve(emptyPage);
      else lookup.reject(new Error('history read failed'));
      await lookup.promise.catch(() => {});
    });
    await flush();
    await expectQuiet();
    // The submission guard must refuse to send once the screen is gone.
    const submitted = bridge.invoice.mock.calls.filter(call => call[0] === 'pay');
    expect(submitted).toEqual([]);
  });

  test('pending-payment status poll that settles after leaving schedules nothing and logs nothing', async () => {
    const poll = deferred<unknown>();
    let calls = 0;
    const { screen, approve } = await startPendingPayment(async () => {
      calls += 1;
      return calls === 1 ? emptyPage : poll.promise;
    });
    // The pay call never returns, so force a visible pending state via the lookup path.
    await act(async () => {
      approve();
    });
    screen.unmount();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      poll.resolve({ rows: [{ id: hash, state: 'settled', direction: 'sent' }], next: '0', more: false });
      await poll.promise;
    });
    expect(jest.getTimerCount()).toBe(0);
    await expectQuiet();
  });
});

describe('XBTLightning settings: rapid leave and re-enter', () => {
  test('a late channel result from the first visit does not leak into the second visit', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let visit = 0;
    bridge.manage.mockImplementation(async action => {
      if (action !== 'channelStatus') return 'fixture-txid';
      visit += 1;
      return visit === 1 ? first.promise : second.promise;
    });
    const firstScreen = render(<XBTLightning />);
    await flush();
    firstScreen.unmount();
    const secondScreen = render(<XBTLightning />);
    await flush();
    // The old screen's request is still pending when the new one starts.
    await act(async () => {
      first.resolve([{ ...channel, point: 'stale-point:0' }]);
      await first.promise;
    });
    await flush();
    expect(secondScreen.queryByTestId('SelectChannel-stale-point:0')).toBeNull();
    await act(async () => {
      second.resolve([channel]);
      await second.promise;
    });
    await flush();
    expect(secondScreen.queryByTestId('SelectChannel-stale-point:0')).toBeNull();
    expect(secondScreen.getByTestId('SelectChannel-fixture-point:0')).toBeTruthy();
    secondScreen.unmount();
    await expectQuiet();
  });

  test('repeated leave/enter cycles with every read pending leave no timers or listeners behind', async () => {
    const pendingForever = new Promise<never>(() => {});
    bridge.run.mockImplementation(async () => pendingForever);
    bridge.manage.mockImplementation(async action => (action === 'channelStatus' ? pendingForever : 'fixture-txid'));
    for (let index = 0; index < 10; index++) {
      const screen = render(<XBTLightning />);
      await flush();
      screen.unmount();
    }
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await expectQuiet();
  });
});

describe('XBTLightningNetwork: late network and watchtower responses', () => {
  const run = async (_title: string, action: () => Promise<void>) => action();
  const props = { status: 'Running', busy: false, report: jest.fn(), onTorChange: jest.fn(), run };
  beforeEach(() => {
    props.report.mockClear();
    props.onTorChange.mockClear();
  });

  test.each(['resolve', 'reject'] as const)('network read that %ss after leaving does not call back into the parent', async outcome => {
    const read = deferred<unknown>();
    bridge.network.mockImplementation(async () => read.promise);
    const screen = render(<XBTLightningNetwork {...props} />);
    await flush();
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') read.resolve(network);
      else read.reject(new Error('network read failed'));
      await read.promise.catch(() => {});
    });
    expect(props.onTorChange).not.toHaveBeenCalled();
    expect(bridge.watchtower).not.toHaveBeenCalled();
    await expectQuiet();
  });

  test.each(['resolve', 'reject'] as const)('watchtower read that %ss after leaving is ignored quietly', async outcome => {
    const read = deferred<unknown>();
    bridge.watchtower.mockImplementation(async () => read.promise);
    const screen = render(<XBTLightningNetwork {...props} />);
    await flush();
    expect(bridge.watchtower).toHaveBeenCalledWith('list', '');
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') read.resolve([tower]);
      else read.reject(new Error('watchtower read failed'));
      await read.promise.catch(() => {});
    });
    await expectQuiet();
  });

  test('timers and AppState subscription are released on leave', async () => {
    const screen = render(<XBTLightningNetwork {...props} />);
    await flush();
    const calls = bridge.network.mock.calls.length;
    screen.unmount();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(bridge.network.mock.calls.length).toBe(calls);
    expect(jest.getTimerCount()).toBe(0);
    await expectQuiet();
  });

  test('a late Add watchtower response after leaving does not report to the parent', async () => {
    const add = deferred<unknown>();
    bridge.watchtower.mockImplementation(async action => (action === 'add' ? add.promise : [tower]));
    const screen = render(<XBTLightningNetwork {...props} />);
    await flush();
    fireEvent.press(screen.getByText('Tor and watchtower settings'));
    await act(async () => {
      fireEvent.press(screen.getByText('Add watchtower'));
    });
    screen.unmount();
    await act(async () => {
      add.resolve([tower]);
      await add.promise;
    });
    expect(props.report).not.toHaveBeenCalled();
    await expectQuiet();
  });

  test('a network response from the first visit does not initialise the second visit', async () => {
    const first = deferred<unknown>();
    let visit = 0;
    bridge.network.mockImplementation(async () => {
      visit += 1;
      return visit === 1 ? first.promise : { ...network, defaultTower: 'second@visit.onion:9911' };
    });
    const firstScreen = render(<XBTLightningNetwork {...props} />);
    await flush();
    firstScreen.unmount();
    const secondScreen = render(<XBTLightningNetwork {...props} />);
    await flush();
    await act(async () => {
      first.resolve({ ...network, defaultTower: 'stale@first.onion:9911' });
      await first.promise;
    });
    await flush();
    fireEvent.press(secondScreen.getByText('Tor and watchtower settings'));
    expect(secondScreen.getByLabelText('Watchtower address').props.value).not.toBe('stale@first.onion:9911');
    secondScreen.unmount();
    await expectQuiet();
  });
});

describe('Lightning home: late refresh responses after leaving', () => {
  test.each(['resolve', 'reject'] as const)('fetchBalance that %ss after leaving does not save or update state', async outcome => {
    const wallet = new LndWallet();
    const fetched = deferred<void>();
    jest.spyOn(wallet, 'fetchBalance').mockImplementation(() => fetched.promise);
    const screen = render(<LndWalletHome wallet={wallet} />);
    await flush();
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') fetched.resolve();
      else fetched.reject(new Error('balance read failed'));
      await fetched.promise.catch(() => {});
    });
    expect(mockStorage.saveToDisk).not.toHaveBeenCalled();
    await expectQuiet();
  });

  test.each(['resolve', 'reject'] as const)('wallet page read that %ss after leaving does not save or update state', async outcome => {
    const wallet = new LndWallet();
    jest.spyOn(wallet, 'fetchBalance').mockResolvedValue(undefined);
    const page = deferred<unknown>();
    bridge.wallet.mockImplementation(async kind => (kind === 'overview' ? overview : page.promise));
    const screen = render(<LndWalletHome wallet={wallet} />);
    await flush();
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') page.resolve({ rows: [], next: '0', more: false });
      else page.reject(new Error('page read failed'));
      await page.promise.catch(() => {});
    });
    expect(mockStorage.saveToDisk).not.toHaveBeenCalled();
    await expectQuiet();
  });

  test.each(['resolve', 'reject'] as const)('saveToDisk that %ss after leaving is ignored quietly', async outcome => {
    const wallet = new LndWallet();
    jest.spyOn(wallet, 'fetchBalance').mockResolvedValue(undefined);
    const saved = deferred<void>();
    mockStorage.saveToDisk = jest.fn(() => saved.promise);
    const screen = render(<LndWalletHome wallet={wallet} />);
    await flush();
    expect(mockStorage.saveToDisk).toHaveBeenCalled();
    screen.unmount();
    await act(async () => {
      if (outcome === 'resolve') saved.resolve();
      else saved.reject(new Error('disk full'));
      await saved.promise.catch(() => {});
    });
    await expectQuiet();
  });

  test('a queued refresh is not started after leaving, and the poll timer is released', async () => {
    const wallet = new LndWallet();
    const fetched = deferred<void>();
    const fetchBalance = jest.spyOn(wallet, 'fetchBalance').mockImplementation(() => fetched.promise);
    const screen = render(<LndWalletHome wallet={wallet} />);
    await flush();
    // Poll fires while the first read is pending, which queues an automatic refresh.
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    const callsWhileVisible = fetchBalance.mock.calls.length;
    screen.unmount();
    await act(async () => {
      fetched.resolve();
      await fetched.promise;
    });
    await flush();
    expect(fetchBalance.mock.calls.length).toBe(callsWhileVisible);
    expect(jest.getTimerCount()).toBe(0);
    await expectQuiet();
  });

  test('a read from the first visit does not paint over the second visit', async () => {
    const wallet = new LndWallet();
    const first = deferred<void>();
    let calls = 0;
    jest.spyOn(wallet, 'fetchBalance').mockImplementation(() => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve();
    });
    const firstScreen = render(<LndWalletHome wallet={wallet} />);
    await flush();
    firstScreen.unmount();
    const secondScreen = render(<LndWalletHome wallet={wallet} />);
    await flush();
    await act(async () => {
      first.reject(new Error('stale failure'));
      await first.promise.catch(() => {});
    });
    await flush();
    expect(secondScreen.queryByText(/Refresh failed/)).toBeNull();
    secondScreen.unmount();
    await expectQuiet();
  });
});
