import React from 'react';
import { NavigationContext } from '@react-navigation/native';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { activePool } from '../../class/xbt/kilojoin/active-pool';
import CoinjoinEntry from '../../screen/settings/CoinjoinExperimental';
import CoinjoinLive from '../../screen/settings/CoinjoinLive';
import Button from '../../components/Button';
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
const mockRecoverRounds = jest.fn<Promise<any[]>, any[]>(async () => []);
const mockConfirmRecovered = jest.fn<Promise<boolean>, any[]>(async () => false);
jest.mock('../../class/xbt/kilojoin/client', () => ({
  recoverWalletRounds: (...args: unknown[]) => mockRecoverRounds(...args),
  confirmRecoveredRound: (...args: unknown[]) => mockConfirmRecovered(...args),
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
  mockRecoverRounds.mockReset().mockResolvedValue([]);
  mockConfirmRecovered.mockReset().mockResolvedValue(false);
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
  fireEvent.press(
    screen.getByText(/^○ v3 · 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/),
  );
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
    fireEvent.press(
      screen.getByText(/^○ v3 · 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/),
    );
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
  fireEvent.press(
    screen.getByText(/^○ v3 · 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/),
  );
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
  expect(entry.getByText('Input signatures: 1/3')).toBeTruthy();
  expect(entry.getByText('Reserved coins: 1')).toBeTruthy();
  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(mockApprove).not.toHaveBeenCalled();
  mockClose.mockImplementationOnce(async () => {
    mockEmit!({
      session: { phase: 'aborted', seats: [], signatures: {} },
      journal: { phase: 'uncertain', reserved: ['11'.repeat(32) + ':0'] },
    });
  });
  fireEvent.press(entry.getByText('Recovery options'));
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
  fireEvent.press(
    screen.getByText(/^○ v3 · 10,000 sats · 2\/5 · 2 sats\/vB\s+Announced deadline: .+ · (?:.+ remaining|Deadline reached)$/),
  );
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
    journal: {
      ...mockView.journal,
      phase: 'joined',
      deadline: 1000,
      reserved: [],
    },
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

test.each([
  {
    signatures: { one: 'sig' },
    broadcastId: undefined,
    message: /Waiting for the other participants to sign/,
  },
  {
    signatures: { one: 'sig', two: 'sig' },
    broadcastId: undefined,
    message: /Next action: broadcast/,
  },
  {
    signatures: { one: 'sig', two: 'sig' },
    broadcastId: 'aa'.repeat(32),
    message: /No action is required from you right now/,
  },
])('signed step is green while remaining work is explicit: $broadcastId $signatures', async ({ signatures, broadcastId, message }) => {
  const retrySignatures = jest.fn(async () => {});
  const broadcast = jest.fn(async () => {});
  const checkConfirmation = jest.fn(async () => false);
  const live = {
    session: {
      phase: 'signed',
      seats: [{ coins: [{}] }, { coins: [{}] }],
      signatures,
    },
    journal: { phase: 'signed', reserved: ['11'.repeat(32) + ':0'] },
    broadcastId,
  };
  await activePool.start(mockWallet, async update => {
    mockEmit = update as typeof mockEmit;
    update(live as never);
    return {
      view: () => live,
      close: mockClose,
      retrySignatures,
      broadcast,
      checkConfirmation,
    } as never;
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  expect(screen.getByText('✓ Your signing is complete')).toHaveStyle({
    color: '#248445',
  });
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
  expect(screen.queryByText('Review and sign')).toBeNull();
  expect(screen.queryByText('Retry sharing signatures')).toBeNull();
  expect(screen.queryByText('Stop participation')).toBeNull();
  if (broadcastId) expect(screen.queryByText('Broadcast joint transaction')).toBeNull();
  else {
    const button = screen.getByText('Broadcast joint transaction');
    if (Object.keys(signatures).length < 2) expect(button).toBeDisabled();
    else expect(button).toBeEnabled();
  }
  expect(screen.getByText('Refresh confirmation status (optional)')).toBeTruthy();
  expect(retrySignatures).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
  expect(checkConfirmation).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Recovery options'));
  expect(screen.getByText('Retry sharing signatures')).toBeTruthy();
  expect(screen.getByText('Stop participation')).toBeTruthy();
  expect(screen.getByText(/Stopping after signing does not release reserved coins/)).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('Retry sharing signatures')));
  expect(retrySignatures).toHaveBeenCalledTimes(1);
  expect(mockApprove).not.toHaveBeenCalled();
});

test.each(['uncertain', 'aborted', 'complete'])(
  'does not claim own step is safely active from stale signed phase with %s journal',
  async phase => {
    const live = {
      session: { phase: 'signed', seats: [], signatures: {} },
      journal: {
        phase,
        reserved: phase === 'uncertain' ? ['11'.repeat(32) + ':0'] : [],
      },
    };
    await activePool.start(mockWallet, async update => {
      mockEmit = update as typeof mockEmit;
      update(live as never);
      return { view: () => live, close: mockClose } as never;
    });
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    expect(screen.queryByTestId('CoinjoinSigningComplete')).toBeNull();
    if (phase === 'uncertain') {
      expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
      expect(screen.getByText('Check retained round confirmation')).toBeTruthy();
    }
  },
);

test('closing approval feedback is separate from signatures and resets for a new vote', async () => {
  const vote = jest.fn(async () => {});
  const live = {
    session: {
      phase: 'voting',
      voteId: 'first',
      deadline: Math.floor(Date.now() / 1000) + 600,
      seats: [{ coins: [{ txid: 'a', vout: 0 }] }, { coins: [{ txid: 'b', vout: 0 }] }],
      signatures: {},
    },
    journal: { phase: 'joined', reserved: ['a:0'] },
  };
  await activePool.start(mockWallet, async update => {
    mockEmit = update as typeof mockEmit;
    update(live as never);
    return { view: () => live, close: mockClose, vote } as never;
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  expect(screen.getByText('Your closing response: not confirmed')).toBeTruthy();
  expect(screen.getByText('Transaction signing: not started')).toBeTruthy();
  expect(screen.queryByText(/Input signatures:/)).toBeNull();
  await act(async () => fireEvent.press(screen.getByText('Accept round closing')));
  expect(vote).toHaveBeenCalledWith(true);
  // A press alone cannot claim success; only a durable session update can.
  expect(screen.queryByText('✓ Your closing approval was sent')).toBeNull();
  const sent = {
    ...live,
    session: {
      ...live.session,
      closingResponse: { voteId: 'first', accept: true },
    },
  };
  await act(async () => mockEmit!(sent));
  expect(screen.getByText('✓ Your closing approval was sent')).toHaveStyle({
    color: '#248445',
  });
  expect(screen.getByText(/Closing approvals: total unavailable/)).toBeTruthy();
  expect(screen.queryByText('Action required: closing vote')).toBeNull();
  expect(screen.queryByText('Accept round closing')).toBeNull();
  expect(screen.queryByText('Decline')).toBeNull();
  expect(screen.queryByText('Resend closing approval (optional)')).toBeNull();
  fireEvent.press(screen.getByText('Closing response options (optional)'));
  expect(screen.getByText('Resend closing approval (optional)')).toBeTruthy();
  await act(async () => mockEmit!({ ...sent, session: { ...sent.session, voteId: 'second' } }));
  expect(screen.queryByText('✓ Your closing approval was sent')).toBeNull();
  expect(screen.getByText('Your closing response: not confirmed')).toBeTruthy();
  expect(screen.getByText('Action required: closing vote')).toBeTruthy();
  expect(screen.getByText('Accept round closing')).toBeEnabled();
  expect(screen.queryByText('Resend closing approval (optional)')).toBeNull();
  await act(async () =>
    mockEmit!({
      ...sent,
      session: {
        ...sent.session,
        phase: 'review',
        signatures: { 'a:0': 'validated' },
      },
    }),
  );
  expect(screen.getByText('Participants signed: 1/2')).toBeTruthy();
  expect(screen.getByText('Input signatures: 1/2')).toBeTruthy();
  expect(mockApprove).not.toHaveBeenCalled();
});

test('closing without a blind response exposes guarded preparation recovery', async () => {
  const retryOutput = jest.fn(async () => {});
  const retryOutputPreparation = jest.fn(async () => {});
  const live = {
    session: {
      phase: 'closing',
      deadline: Math.floor(Date.now() / 1000) + 300,
      seats: [{ coins: [{}] }, { coins: [{}] }, { coins: [{}] }],
      signatures: {},
    },
    journal: { phase: 'joined', reserved: ['a:0'] },
    error: 'Could not connect to the CoinJoin relay. Coins remain reserved until the round is resolved.',
  };
  await activePool.start(mockWallet, async update => {
    mockEmit = update as typeof mockEmit;
    update(live as never);
    return {
      view: () => live,
      close: mockClose,
      retryOutput,
      retryOutputPreparation,
    } as never;
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  expect(screen.getByText('Retry output registration')).toBeDisabled();
  expect(screen.getByText('Retry output preparation')).toBeEnabled();
  await act(async () => fireEvent.press(screen.getByText('Retry output preparation')));
  expect(retryOutputPreparation).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
  expect(screen.getByText('Stop participation')).toBeEnabled();
  expect(retryOutput).not.toHaveBeenCalled();
  expect(mockApprove).not.toHaveBeenCalled();
});

test.each([-1, 0, 1])('output preparation retry obeys the absolute deadline boundary: %i seconds', async remaining => {
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const now = 1000;
  const retryOutputPreparation = jest.fn(async () => {});
  const live = {
    session: {
      phase: 'closing',
      deadline: now + remaining,
      phaseStartedAt: now - 120,
      seats: [{ coins: [{}] }, { coins: [{}] }],
      signatures: {},
      outputProgress: { total: 1, submitted: 0, prepared: false },
    },
    journal: { phase: 'joined', reserved: ['a:0'] },
  };
  await activePool.start(mockWallet, async update => {
    mockEmit = update as typeof mockEmit;
    update(live as never);
    return {
      view: () => live,
      close: mockClose,
      retryOutputPreparation,
    } as never;
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  const button = screen.getByText('Retry output preparation');
  if (remaining <= 0) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(screen.getByText('In this stage for 2m 0s')).toBeTruthy();
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
  expect(retryOutputPreparation).not.toHaveBeenCalled();
});

test('output delay timer catches up on foreground and completed relay sends remain distinct from round completion', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(1000000);
  let foreground: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  const live = {
    session: {
      phase: 'closing',
      deadline: 1300,
      phaseStartedAt: 990,
      outputNotBefore: 1040,
      seats: [{ coins: [{}] }, { coins: [{}] }],
      signatures: {},
      outputProgress: { total: 5, submitted: 2, prepared: true },
    },
    journal: { phase: 'joined', reserved: ['a:0'] },
  };
  try {
    await activePool.start(mockWallet, async update => {
      mockEmit = update as typeof mockEmit;
      update(live as never);
      return { view: () => live, close: mockClose } as never;
    });
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    expect(screen.getByText('Next automatic output submission: 0m 40s remaining')).toBeTruthy();
    expect(screen.getByText(/2\/5 of your outputs acknowledged/)).toBeTruthy();
    jest.setSystemTime(1100000);
    act(() => foreground!('active'));
    expect(screen.queryByText(/Next automatic output submission:/)).toBeNull();
    expect(screen.getByText('In this stage for 1m 50s')).toBeTruthy();
    await act(async () =>
      mockEmit!({
        ...live,
        session: {
          ...live.session,
          outputNotBefore: undefined,
          outputProgress: { total: 5, submitted: 5, prepared: true },
        },
      }),
    );
    expect(screen.getByText('✓ Your outputs were sent')).toBeTruthy();
    expect(screen.getByText(/Waiting for the creator’s complete output list/)).toBeTruthy();
    expect(screen.getByText('Status: Registering outputs')).toBeTruthy();
    expect(screen.queryByText('Review and sign')).toBeNull();
    expect(mockApprove).not.toHaveBeenCalled();
  } finally {
    cleanup();
    jest.useRealTimers();
  }
});

test('v5 pool selection explains the joiner role without autojoining or signing', async () => {
  const original = { ...mockTerms };
  Object.assign(mockTerms, { v: 5, outputs: 2, payments: [7123, 12877] });
  try {
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    await act(async () => {
      fireEvent.press(screen.getByText('Find pools'));
    });
    fireEvent.press(screen.getByText(/^○ v5 payment pool · 2 × 10,000 sats/));
    expect(screen.getByText(/Payment pool: the creator pays recipients. You receive 2 × 10,000 sats in mixed outputs./)).toBeTruthy();
    expect(mockJoin).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  } finally {
    Object.assign(mockTerms, original);
    delete (mockTerms as Record<string, unknown>).outputs;
    delete (mockTerms as Record<string, unknown>).payments;
  }
});

async function startClosingVote(vote: (accept: boolean) => Promise<void>, response?: boolean) {
  const live = {
    session: {
      phase: 'voting',
      voteId: 'current-vote',
      deadline: Math.floor(Date.now() / 1000) + 600,
      seats: [{ coins: [{ txid: 'a', vout: 0 }] }, { coins: [{ txid: 'b', vout: 0 }] }],
      signatures: {},
      ...(response === undefined ? {} : { closingResponse: { voteId: 'current-vote', accept: response } }),
    },
    journal: { phase: 'joined', reserved: ['a:0'] },
  };
  await activePool.start(mockWallet, async update => {
    mockEmit = update as typeof mockEmit;
    update(live as never);
    return { view: () => live, close: mockClose, vote } as never;
  });
  return live;
}

test.each([true, false])('closing response %s sends once, waits for durable feedback and survives screen reentry', async accept => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const vote = jest.fn(async () => {
    await pending;
    mockEmit!({
      ...live,
      session: {
        ...live.session,
        closingResponse: { voteId: 'current-vote', accept },
      },
    });
  });
  const live = await startClosingVote(vote);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  const label = accept ? 'Accept round closing' : 'Decline';
  const press = screen.UNSAFE_getAllByType(Button).find(button => button.props.title === label)!.props.onPress;
  let action!: Promise<void>;
  act(() => {
    action = press();
    press();
  });
  try {
    expect(vote).toHaveBeenCalledTimes(1);
    expect(vote).toHaveBeenCalledWith(accept);
    expect(screen.getByText(accept ? 'Sending closing approval…' : 'Sending decline…')).toBeDisabled();
    expect(screen.queryByText('✓ Your closing approval was sent')).toBeNull();
    expect(screen.queryByText('Your decline was sent')).toBeNull();
    expect(screen.getByText(accept ? 'Decline' : 'Accept round closing')).toBeDisabled();
  } finally {
    await act(async () => {
      finish();
      await action;
    });
  }
  const feedback = accept ? '✓ Your closing approval was sent' : 'Your decline was sent';
  expect(screen.getByText(feedback)).toBeTruthy();
  expect(screen.queryByText('Accept round closing')).toBeNull();
  expect(screen.queryByText('Decline')).toBeNull();
  await act(async () => press());
  expect(vote).toHaveBeenCalledTimes(1);
  screen.unmount();
  const reopened = render(<CoinjoinLive experimentalAcknowledged />);
  expect(reopened.getByText(feedback)).toBeTruthy();
  expect(reopened.queryByText('Accept round closing')).toBeNull();
  expect(reopened.queryByText('Decline')).toBeNull();
  expect(reopened.queryByText(/Resend closing/)).toBeNull();
  expect(reopened.getByText('Transaction signing: not started')).toBeTruthy();
  expect(reopened.getByText('Reserved coins: 1')).toBeTruthy();
  expect(mockApprove).not.toHaveBeenCalled();
});

test.each(['Relay unavailable', 'Session persistence failed'])(
  'failed closing response remains retryable without false success: %s',
  async message => {
    const vote = jest.fn(async () => {
      throw new Error(message);
    });
    await startClosingVote(vote);
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    await act(async () => fireEvent.press(screen.getByText('Accept round closing')));
    expect(vote).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('✓ Your closing approval was sent')).toBeNull();
    expect(screen.getByText('Accept round closing')).toBeEnabled();
    expect(screen.getByText('Decline')).toBeEnabled();
    expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('Accept round closing')));
    expect(vote).toHaveBeenCalledTimes(2);
    expect(mockApprove).not.toHaveBeenCalled();
  },
);

test('an old closing button cannot respond to a replacement vote', async () => {
  const vote = jest.fn(async () => {});
  const live = await startClosingVote(vote);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  const oldPress = screen.UNSAFE_getAllByType(Button).find(button => button.props.title === 'Accept round closing')!.props.onPress;
  await act(async () =>
    mockEmit!({
      ...live,
      session: { ...live.session, voteId: 'replacement-vote' },
    }),
  );
  await act(async () => oldPress());
  expect(vote).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('Accept round closing')));
  expect(vote).toHaveBeenCalledTimes(1);
});

test.each([true, false])('sent response %s only exposes deliberate same-response retry', async accept => {
  const vote = jest.fn(async () => {});
  await startClosingVote(vote, accept);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  expect(screen.queryByText('Accept round closing')).toBeNull();
  expect(screen.queryByText('Decline')).toBeNull();
  expect(screen.queryByText(/Resend closing/)).toBeNull();
  const options = screen.getByRole('button', {
    name: 'Closing response options (optional)',
  });
  expect(options.props.accessibilityState).toEqual({ expanded: false });
  fireEvent.press(options);
  const resend = accept ? 'Resend closing approval (optional)' : 'Resend closing decline (optional)';
  await act(async () => fireEvent.press(screen.getByText(resend)));
  expect(vote).toHaveBeenLastCalledWith(accept);
  expect(vote).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Change response to decline')).toBeNull();
  expect(screen.queryByText('Change response to accept')).toBeNull();
  expect(screen.getByText('Sent to the relay; creator acknowledgment is not available.')).toBeTruthy();
  expect(mockApprove).not.toHaveBeenCalled();
});

test.each([undefined, true, false])(
  'closing controls and retained callbacks stop at the absolute deadline: response %s',
  async response => {
    const now = 1000000;
    const time = jest.spyOn(Date, 'now').mockReturnValue(now);
    const vote = jest.fn(async () => {});
    await startClosingVote(vote, response);
    const screen = render(<CoinjoinLive experimentalAcknowledged />);
    if (response !== undefined) fireEvent.press(screen.getByText('Closing response options (optional)'));
    const label =
      response === undefined
        ? 'Accept round closing'
        : response
          ? 'Resend closing approval (optional)'
          : 'Resend closing decline (optional)';
    const press = screen.UNSAFE_getAllByType(Button).find(button => button.props.title === label)!.props.onPress;
    time.mockReturnValue(now + 600000);
    await act(async () => press());
    expect(vote).not.toHaveBeenCalled();
    screen.unmount();
    const expired = render(<CoinjoinLive experimentalAcknowledged />);
    if (response !== undefined) fireEvent.press(expired.getByText('Closing response options (optional)'));
    expect(expired.getByText(label)).toBeDisabled();
    expect(expired.getByText('Response deadline reached')).toBeTruthy();
    expect(expired.getByText('Reserved coins: 1')).toBeTruthy();
  },
);

test('a retained retry cannot replace a different saved closing response', async () => {
  const vote = jest.fn(async () => {});
  const live = await startClosingVote(vote, true);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  fireEvent.press(screen.getByText('Closing response options (optional)'));
  const retry = screen.UNSAFE_getAllByType(Button).find(button => button.props.title === 'Resend closing approval (optional)')!.props
    .onPress;
  await act(async () =>
    mockEmit!({
      ...live,
      session: {
        ...live.session,
        closingResponse: { voteId: 'current-vote', accept: false },
      },
    }),
  );
  await act(async () => retry());
  expect(vote).not.toHaveBeenCalled();
  expect(screen.getByText('Your decline was sent')).toBeTruthy();
});

async function startConfirmationRound(checkConfirmation: () => Promise<boolean>, phase = 'signed') {
  const live = {
    session: {
      phase: 'signed',
      seats: [{ coins: [{}] }],
      signatures: { one: 'sig' },
    },
    journal: {
      phase,
      reviewedId: 'aa'.repeat(32),
      reserved: ['11'.repeat(32) + ':0'],
    },
    broadcastId: 'aa'.repeat(32),
  };
  await activePool.start(mockWallet, async update => {
    mockEmit = update as typeof mockEmit;
    update(live as never);
    return { view: () => live, close: mockClose, checkConfirmation } as never;
  });
  return live;
}

test('checks signed confirmation on entry and re-entry without treating a pending block as failure', async () => {
  const check = jest.fn(async () => false);
  await startConfirmationRound(check);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {});
  expect(check).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('CoinjoinConfirmationNotice')).toHaveTextContent(/Waiting for blockchain confirmation/);
  expect(screen.queryByTestId('CoinjoinIssueCategory')).toBeNull();
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
  screen.unmount();
  render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {});
  expect(check).toHaveBeenCalledTimes(2);
  expect(mockApprove).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

test('screen focus and foreground share one in-flight check and do not poll on render', async () => {
  let finish!: (confirmed: boolean) => void;
  const check = jest.fn(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve;
      }),
  );
  await startConfirmationRound(check);
  let foreground!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  let focus!: () => void;
  const detach = jest.fn();
  const nav = {
    isFocused: () => true,
    addListener: (_event: string, listener: () => void) => {
      focus = listener;
      return detach;
    },
  };
  const screen = render(
    <NavigationContext.Provider value={nav as never}>
      <CoinjoinLive experimentalAcknowledged />
    </NavigationContext.Provider>,
  );
  act(() => {
    focus();
    foreground('active');
  });
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => finish(false));
  expect(check).toHaveBeenCalledTimes(1);
  act(() => focus());
  expect(check).toHaveBeenCalledTimes(2);
  await act(async () => finish(false));
  act(() => foreground('background'));
  expect(check).toHaveBeenCalledTimes(2);
  act(() => foreground('active'));
  expect(check).toHaveBeenCalledTimes(3);
  screen.unmount();
  await act(async () => finish(false));
  expect(detach).toHaveBeenCalledTimes(1);
  expect(activePool.snapshot()?.busy).toBe(false);
});

test('successful verification updates confirmed state and further returns do not check again', async () => {
  const check = jest.fn(async () => {
    mockEmit!({
      ...live,
      journal: { ...live.journal, phase: 'complete', reserved: [] },
    });
    return true;
  });
  const live = await startConfirmationRound(check);
  let foreground!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {});
  expect(screen.getByText('Status: Confirmed')).toBeTruthy();
  expect(screen.getByText('Reserved coins: 0')).toBeTruthy();
  await act(async () => foreground('active'));
  expect(check).toHaveBeenCalledTimes(1);
});

test('failed confirmation verification leaves reservations intact and retries on next foreground', async () => {
  const check = jest.fn().mockRejectedValueOnce(new Error('Backend unavailable')).mockResolvedValue(false);
  await startConfirmationRound(check, 'uncertain');
  let foreground!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {});
  expect(screen.getByText('Backend unavailable')).toBeTruthy();
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
  await act(async () => foreground('active'));
  expect(check).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Backend unavailable')).toBeNull();
  expect(screen.queryByTestId('CoinjoinIssueCategory')).toBeNull();
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
});

test.each(['review', 'joined', 'complete', 'aborted'])('never auto-confirms a %s journal', async phase => {
  const check = jest.fn(async () => false);
  await startConfirmationRound(check, phase);
  render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {});
  expect(check).not.toHaveBeenCalled();
  expect(mockApprove).not.toHaveBeenCalled();
});

test('selecting a wallet after restart automatically verifies saved rounds and keeps the frozen-output notice', async () => {
  jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([]);
  mockRecoverRounds.mockResolvedValueOnce([{ phase: 'uncertain', poolId: 'saved', reviewedId: 'aa'.repeat(32) }]);
  mockConfirmRecovered.mockResolvedValue(true);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  expect(mockConfirmRecovered).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('○ Test wallet')));
  expect(mockConfirmRecovered).toHaveBeenCalledWith(mockWallet, 'saved');
  expect(screen.getByTestId('CoinjoinConfirmationNotice')).toHaveTextContent(/Recovered outputs remain frozen for review in Coin Control/);
  expect(mockApprove).not.toHaveBeenCalled();
  expect(mockJoin).not.toHaveBeenCalled();
});

test('recovered pending and failed checks keep the saved round available', async () => {
  jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([]);
  mockRecoverRounds.mockResolvedValue([{ phase: 'uncertain', poolId: 'saved', reviewedId: 'aa'.repeat(32) }]);
  mockConfirmRecovered.mockRejectedValueOnce(new Error('Invalid transaction bytes')).mockResolvedValue(false);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => fireEvent.press(screen.getByText('○ Test wallet')));
  expect(screen.getByText('Invalid transaction bytes')).toBeTruthy();
  expect(screen.getByText('Check previous round confirmation')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('● Test wallet')));
  expect(screen.queryByTestId('CoinjoinIssueCategory')).toBeNull();
  expect(screen.getByText('Check previous round confirmation')).toBeTruthy();
  expect(screen.getByTestId('CoinjoinConfirmationNotice')).toHaveTextContent(/Coins remain reserved/);
});

test('busy actions and unfocused screens postpone automatic confirmation until a later focus', async () => {
  const check = jest.fn(async () => false);
  await startConfirmationRound(check);
  let release!: () => void;
  const pending = activePool.perform(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  let focus!: () => void;
  const isFocused = jest.fn(() => true);
  const nav = {
    isFocused,
    addListener: (_event: string, listener: () => void) => {
      focus = listener;
      return () => {};
    },
  };
  render(
    <NavigationContext.Provider value={nav as never}>
      <CoinjoinLive experimentalAcknowledged />
    </NavigationContext.Provider>,
  );
  await act(async () => {});
  expect(check).not.toHaveBeenCalled();
  await act(async () => {
    release();
    await pending;
  });
  isFocused.mockReturnValue(false);
  await act(async () => focus());
  expect(check).not.toHaveBeenCalled();
  isFocused.mockReturnValue(true);
  await act(async () => focus());
  expect(check).toHaveBeenCalledTimes(1);
});

test('manual confirmation refresh uses a neutral pending status too', async () => {
  const check = jest.fn(async () => false);
  await startConfirmationRound(check);
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByText('Refresh confirmation status (optional)')));
  expect(check).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('CoinjoinIssueCategory')).toBeNull();
  expect(screen.getByText('Reserved coins: 1')).toBeTruthy();
});
