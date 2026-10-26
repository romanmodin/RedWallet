import React from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { activePool } from '../../class/xbt/kilojoin/active-pool';
import CoinjoinEntry from '../../screen/settings/CoinjoinExperimental';
import CoinjoinLive from '../../screen/settings/CoinjoinLive';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
const mockWallet = new XbtSegwitBech32Wallet();
mockWallet.setLabel('Test wallet');
const mockTerms = {
  v: 3,
  id: 'ab'.repeat(8),
  denomination: 10000,
  fee_rate: 2,
  peers: 2,
  max_peers: 5,
  max_inputs: 10,
  script: 'p2wpkh',
  timeout: 9999999999,
};
const mockView = {
  review: { count: 1, amount: 10000, total: 10000, change: 39729 },
  session: { phase: 'review', seats: [], signatures: {} },
  journal: {
    phase: 'review',
    myFee: 271,
    commitment: 'approved-commitment',
    reviewedId: '11'.repeat(32),
  },
};
const mockApprove = jest.fn(async () => {}),
  mockClose = jest.fn(async () => {});
let mockEmit: ((view: unknown) => void) | undefined;
const mockJoin = jest.fn(async (config: { onUpdate: (view: unknown) => void }) => {
  mockEmit = config.onUpdate;
  config.onUpdate(mockView);
  return { view: () => mockView, approve: mockApprove, close: mockClose };
});
jest.mock('../../class/xbt/kilojoin/client', () => ({
  recoverWalletRounds: async () => [],
  confirmRecoveredRound: async () => false,
  MixingClient: {
    join: (config: { onUpdate: (view: unknown) => void }) => mockJoin(config),
  },
}));
jest.mock('../../class/xbt/kilojoin/protocol', () => ({
  ...jest.requireActual('../../class/xbt/kilojoin/protocol'),
  LIVE_JOIN_ENABLED: true,
  parsePool: () => mockTerms,
}));
let mockSearchMode: 'pool' | 'empty' | 'pending' | 'error' = 'pool';
let mockFinishSearch: (() => void) | undefined;
jest.mock('../../class/xbt/kilojoin/relay', () => ({
  KilojoinRelay: class {
    private readonly receive: (event: unknown) => Promise<void>;
    constructor(receive: (event: unknown) => Promise<void>) {
      this.receive = receive;
    }

    async connect() {}
    async discoverPools() {
      if (mockSearchMode === 'error') throw new Error('Relay rejected the subscription');
      if (mockSearchMode === 'pending')
        await new Promise<void>(resolve => {
          mockFinishSearch = resolve;
        });
      if (mockSearchMode === 'pool') await this.receive({ created_at: 1 });
    }

    close() {}
  },
}));
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => ({ wallets: [mockWallet] }),
}));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockEmit = undefined;
  mockSearchMode = 'pool';
  mockFinishSearch = undefined;
});
afterEach(async () => {
  cleanup();
  if (activePool.snapshot()) {
    mockEmit!({ ...mockView, journal: { phase: 'aborted', reserved: [] } });
    await activePool.dismiss();
  }
  jest.restoreAllMocks();
});
test('live controls select coins but require an explicit confirmation before signing', async () => {
  jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([{ txid: '11'.repeat(32), vout: 0, value: 50000 } as never]);
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('○ Test wallet'));
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  fireEvent.press(screen.getByText(/^○ 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/));
  fireEvent.press(screen.getByText('○ 50,000 sats · 11111111…:0'));
  await act(async () => {
    fireEvent.press(screen.getByText('Join pool and reserve coins'));
  });
  expect(mockJoin).toHaveBeenCalledWith(
    expect.objectContaining({
      selected: ['11'.repeat(32) + ':0'],
      maxFee: 1000,
      experimentalAcknowledged: true,
    }),
  );
  fireEvent.press(screen.getByText('Review and sign'));
  expect(mockApprove).not.toHaveBeenCalled();
  expect(prompt.mock.calls[0][1]).toContain('1 mixed output(s) of 10,000 sats each');
  expect(prompt.mock.calls[0][1]).toContain('Change: 39,729 sats (not mixed)');
  const buttons = prompt.mock.calls[0][2]!;
  await act(async () => {
    buttons.find(b => b.text === 'Sign transaction')!.onPress!();
  });
  expect(mockApprove).toHaveBeenCalledWith('approved-commitment');
});

test('shows search progress until relay completion, then reports no pools', async () => {
  mockSearchMode = 'pending';
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  expect(screen.getByText('Searching for pools…')).toBeTruthy();
  expect(screen.getByText('Connected. Checking open pools…')).toBeTruthy();
  await act(async () => {
    mockFinishSearch!();
  });
  expect(screen.getByText(/Connected. No compatible open pools right now/)).toBeTruthy();
  expect(screen.getByText('Find pools')).toBeTruthy();
});
test('shows compatible pool count after successful discovery', async () => {
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  expect(screen.getByText('1 compatible open pool found. Listening for updates.')).toBeTruthy();
});
test('shows rejected discovery and allows a successful retry', async () => {
  mockSearchMode = 'error';
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  expect(screen.getByText('Relay rejected the subscription')).toBeTruthy();
  expect(screen.getByText('Pool search failed or disconnected. Tap Find pools to retry.')).toBeTruthy();
  mockSearchMode = 'pool';
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  expect(screen.getByText('1 compatible open pool found. Listening for updates.')).toBeTruthy();
  expect(screen.queryByText('Relay rejected the subscription')).toBeNull();
});

test.each(['aborted', 'uncertain', 'joined'] as const)(
  'stopped-session display follows the durable %s journal, not the session phase',
  async phase => {
    jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
    jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([{ txid: '11'.repeat(32), vout: 0, value: 50000 } as never]);
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    await act(async () => {
      fireEvent.press(screen.getByText('○ Test wallet'));
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Find pools'));
    });
    fireEvent.press(screen.getByText(/^○ 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/));
    fireEvent.press(screen.getByText('○ 50,000 sats · 11111111…:0'));
    await act(async () => {
      fireEvent.press(screen.getByText('Join pool and reserve coins'));
    });
    await act(async () => {
      mockEmit!({
        session: {
          phase: phase === 'joined' ? 'open' : 'aborted',
          ...(phase === 'aborted' ? { terminalCause: 'creator-rejected' } : {}),
          seats: [],
          signatures: {},
        },
        journal: {
          phase,
          reserved: phase === 'aborted' ? [] : ['11'.repeat(32) + ':0'],
        },
      });
    });
    const released = "Participation stopped. This round's coin reservations have been released.";
    if (phase === 'aborted') {
      expect(screen.getByText('Status: Rejected by pool')).toBeTruthy();
      expect(screen.getByText('The pool creator rejected this participation attempt.')).toBeTruthy();
      expect(screen.getByText(released)).toBeTruthy();
      expect(screen.queryByText('Stop participation')).toBeNull();
    } else {
      expect(screen.queryByText(released)).toBeNull();
      expect(screen.getByText('Stop participation')).toBeTruthy();
      if (phase === 'uncertain') {
        expect(screen.getByText('Status: Stopped · coins reserved')).toBeTruthy();
        expect(screen.getByText('Check retained round confirmation')).toBeTruthy();
        expect(screen.getByText(/Your signature may have been shared/)).toBeTruthy();
      } else {
        expect(screen.getByText('Status: Accepted · validating participants')).toBeTruthy();
        expect(screen.getByText('Participants: Awaiting validation')).toBeTruthy();
        expect(screen.queryByText('Participants: 0')).toBeNull();
        await act(async () => {
          mockEmit!({
            session: {
              phase: 'open',
              seats: [{ coins: [] }, { coins: [] }],
              signatures: {},
            },
            journal: { phase: 'joined', reserved: ['11'.repeat(32) + ':0'] },
          });
        });
        expect(screen.getByText('Participants: 2')).toBeTruthy();
      }
    }
    expect(mockApprove).not.toHaveBeenCalled();
  },
);

test('leaving the screen does not stop an active pool', async () => {
  jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([{ txid: '11'.repeat(32), vout: 0, value: 50000 } as never]);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('○ Test wallet'));
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  fireEvent.press(screen.getByText(/^○ 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/));
  fireEvent.press(screen.getByText('○ 50,000 sats · 11111111…:0'));
  await act(async () => {
    fireEvent.press(screen.getByText('Join pool and reserve coins'));
  });
  screen.unmount();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => {
    mockEmit!({
      session: {
        phase: 'signed',
        seats: [{ coins: [{}] }, { coins: [{}] }, { coins: [{}] }],
        signatures: { one: 'signature' },
      },
      journal: { phase: 'signed', reserved: ['11'.repeat(32) + ':0'] },
    });
  });
  const entry = render(<CoinjoinEntry />);
  expect(entry.getByText('Return to active pool')).toBeTruthy();
  fireEvent.press(entry.getByTestId('CoinjoinReturnActive'));
  expect(entry.getByText('Participants: 3')).toBeTruthy();
  expect(entry.getByText('Signatures: 1/3')).toBeTruthy();
  expect(entry.getByText('Reserved coins: 1')).toBeTruthy();
  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(mockApprove).not.toHaveBeenCalled();
  mockClose.mockImplementationOnce(async () => {
    mockEmit!({
      session: { phase: 'aborted', seats: [], signatures: {} },
      journal: { phase: 'uncertain', reserved: ['11'.repeat(32) + ':0'] },
    });
  });
  await act(async () => {
    fireEvent.press(entry.getByText('Stop participation'));
  });
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(entry.getByText('Reserved coins: 1')).toBeTruthy();
  expect(entry.getByText('Check retained round confirmation')).toBeTruthy();
});

test('a join finishing after navigation remains reachable instead of being canceled', async () => {
  jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([{ txid: '11'.repeat(32), vout: 0, value: 50000 } as never]);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  mockJoin.mockImplementationOnce(async config => {
    mockEmit = config.onUpdate;
    await pending;
    config.onUpdate(mockView);
    return { view: () => mockView, approve: mockApprove, close: mockClose };
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('○ Test wallet'));
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  fireEvent.press(screen.getByText(/^○ 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/));
  fireEvent.press(screen.getByText('○ 50,000 sats · 11111111…:0'));
  await act(async () => {
    fireEvent.press(screen.getByText('Join pool and reserve coins'));
  });
  screen.unmount();
  const entry = render(<CoinjoinEntry />);
  fireEvent.press(entry.getByTestId('CoinjoinReturnActive'));
  expect(entry.getByText(/Joining pool…/)).toBeTruthy();
  await act(async () => {
    finish();
  });
  expect(entry.getByText('Review and sign')).toBeTruthy();
  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockApprove).not.toHaveBeenCalled();
});

test('foreground immediately recomputes the active timer from wall time after suspension', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(400000);
  let foreground: ((state: AppStateStatus) => void) | undefined;
  const original = AppState.addEventListener;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  const live = {
    ...mockView,
    session: { ...mockView.session, phase: 'voting', deadline: 1000 },
    journal: { ...mockView.journal, phase: 'joined', deadline: 1000, reserved: [] },
  };
  try {
    await activePool.start(mockWallet, async update => {
      mockEmit = update as typeof mockEmit;
      update(live as never);
      return { view: () => live, close: mockClose } as never;
    });
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    expect(screen.getAllByText(/10m 0s remaining/).length).toBeTruthy();
    expect(screen.getByTestId('CoinjoinActionRequired')).toBeTruthy();
    // Jump the wall clock without firing interval ticks, as happens during iOS suspension.
    jest.setSystemTime(700000);
    act(() => foreground!('active'));
    expect(screen.getAllByText(/5m 0s remaining/).length).toBeTruthy();
    jest.setSystemTime(1100000);
    act(() => foreground!('active'));
    expect(screen.getByText('Response deadline reached')).toBeTruthy();
  } finally {
    cleanup();
    AppState.addEventListener = original;
    jest.useRealTimers();
  }
});
