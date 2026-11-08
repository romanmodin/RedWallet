import Clipboard from '@react-native-clipboard/clipboard';
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { Alert, AppState, NativeModules } from 'react-native';

const mockAuthorize = jest.fn(async () => true);
const mockAuthorizeExport = jest.fn(async () => true);
jest.mock('../../hooks/usePaymentAuthorization', () => ({
  usePaymentAuthorization: () => mockAuthorize,
}));
jest.mock('../../hooks/useSecretExport', () => ({
  useSecretExport: () => mockAuthorizeExport,
}));
beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(true);
  mockAuthorizeExport.mockReset().mockResolvedValue(true);
});
const mockNavigation = { navigate: jest.fn() };
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('@react-native-documents/picker', () => ({ types: {} }));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../components/QRCode', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
const bridge = {
  peer: jest.fn(async () => ''),
  manage: jest.fn(
    async (action: string): Promise<unknown> =>
      action === 'channelStatus'
        ? []
        : action === 'withdrawReview'
          ? {
              token: 'review-token',
              address: 'bc1q-fixture',
              sats: '1000',
              feeRate: '2',
            }
          : 'fixture-txid',
  ),
  run: jest.fn<Promise<string>, [string, string]>(async () => 'Running'),
  invoice: jest.fn(
    async (action: string): Promise<unknown> =>
      action === 'decode' ? { sats: '500', destination: 'test peer', hash: 'reviewed-hash' } : true,
  ),
};
NativeModules.XBTLightningBridge = bridge;
const XBTLightning = require('../../screen/settings/XBTLightning').default;

test('review decodes an invoice without paying; confirmation binds the amount and hash and ignores a repeated tap', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('Invoice to pay'), 'lnbcrt-fixture');
    await act(async () => fireEvent.press(screen.getByText('Review invoice')));
    expect(bridge.invoice.mock.calls.map(call => call[0])).toEqual(['decode']);
    fireEvent.press(screen.getByText('Pay 500 sats'));
    const [, detail, buttons] = prompt.mock.calls[0];
    expect(detail).toContain('10 sats');
    const approve = buttons!.find(button => button.text === 'Pay')!.onPress!;
    await act(async () => {
      approve();
      approve();
    });
    expect(bridge.invoice).toHaveBeenCalledWith('pay', 'lnbcrt-fixture', 'reviewed-hash', '500');
    expect(bridge.invoice.mock.calls.map(call => call[0])).toEqual(['decode', 'pay']);
    expect(screen.getByText('Payment settled.')).toBeTruthy();
  } finally {
    prompt.mockRestore();
  }
});

test('unlocked startup refreshes automatically instead of leaving a static screen', async () => {
  jest.useFakeTimers();
  bridge.run.mockResolvedValueOnce('Unlocked').mockResolvedValue('Running');
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    expect(screen.getByText(/Status updates automatically/)).toBeTruthy();
    expect(screen.queryByText('Node and channel balances')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Node and channel balances')).toBeTruthy();
    screen.unmount();
  } finally {
    jest.useRealTimers();
    bridge.run.mockResolvedValue('Running');
  }
});

test('public node setup defaults to automatic XBT peers and does not request a regtest server', async () => {
  bridge.run.mockClear();
  bridge.run.mockResolvedValueOnce('Stopped').mockResolvedValue('Needs setup');
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    expect(screen.getByLabelText('Optional XBT chain peer').props.value).toBe('');
    expect(screen.queryByText(/Private XBT test network/)).toBeNull();
    await act(async () => fireEvent.press(screen.getByText('Start XBT node')));
    expect(bridge.run).toHaveBeenCalledWith('start', '');
    expect(screen.getByText('Create Lightning wallet')).toBeTruthy();
    screen.unmount();
  } finally {
    bridge.run.mockResolvedValue('Running');
  }
});

test('withdrawal requires confirmation, binds the reviewed token, and submits once', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  bridge.manage.mockClear();
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('Withdrawal address'), 'bc1q-fixture');
    fireEvent.changeText(screen.getByLabelText('Withdrawal sats'), '1000');
    fireEvent.changeText(screen.getByLabelText('On-chain fee rate'), '2');
    await act(async () => fireEvent.press(screen.getByText('Review withdrawal')));
    expect(bridge.manage.mock.calls.map(c => c[0]).filter(action => action !== 'channelStatus')).toEqual(['withdrawReview']);
    fireEvent.press(screen.getByText('Withdraw 1000 sats'));
    const [, detail, buttons] = prompt.mock.calls[0];
    expect(detail).toContain('bc1q-fixture');
    expect(detail).toContain('2 sat/vB');
    const confirm = buttons!.find(button => button.text === 'Withdraw')!.onPress!;
    await act(async () => {
      confirm();
      confirm();
    });
    expect(bridge.manage).toHaveBeenCalledWith('withdraw', 'review-token', '', '');
    expect(bridge.manage.mock.calls.map(c => c[0]).filter(action => action !== 'channelStatus')).toEqual(['withdrawReview', 'withdraw']);
    expect(screen.getByText('Withdrawal broadcast: fixture-txid')).toBeTruthy();
    screen.unmount();
  } finally {
    prompt.mockRestore();
  }
});

test('editing withdrawal details invalidates the prior review', async () => {
  const screen = render(<XBTLightning />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Withdrawal address'), 'bc1q-fixture');
  fireEvent.changeText(screen.getByLabelText('Withdrawal sats'), '1000');
  await act(async () => fireEvent.press(screen.getByText('Review withdrawal')));
  expect(screen.getByText('Withdraw 1000 sats')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Withdrawal sats'), '2000');
  expect(screen.queryByText('Withdraw 1000 sats')).toBeNull();
  screen.unmount();
});

test('cooperative close confirms the selected channel and fee rate and ignores a repeated tap', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  bridge.manage.mockClear();
  const channels = [
    {
      point: 'fixture-point:0',
      peer: 'fixture-peer',
      active: true,
      state: 'active',
      localSats: '82000',
    },
  ];
  bridge.manage.mockResolvedValueOnce(channels).mockResolvedValueOnce(channels);
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('On-chain fee rate'), '2');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Refresh channels' })));
    expect(screen.queryByText('Close channel · 82000 local sats')).toBeNull();
    fireEvent.press(screen.getByTestId('SelectChannel-fixture-point:0'));
    fireEvent.press(screen.getByText('Close channel · 82000 local sats'));
    expect(bridge.manage.mock.calls.map(c => c[0]).filter(action => action !== 'channelStatus')).toEqual([]);
    const [, detail, buttons] = prompt.mock.calls[0];
    expect(detail).toContain('Starting fee rate: 2 sat/vB');
    expect(detail).toContain('capped at 6 sat/vB');
    fireEvent.changeText(screen.getByLabelText('On-chain fee rate'), '3');
    const confirm = buttons!.find(button => button.text === 'Close channel')!.onPress!;
    await act(async () => {
      confirm();
      confirm();
    });
    expect(bridge.manage).toHaveBeenCalledWith('close', 'fixture-point:0', '', '2');
    expect(bridge.manage.mock.calls.map(c => c[0]).filter(action => action !== 'channelStatus')).toEqual(['close']);
    screen.unmount();
  } finally {
    prompt.mockRestore();
  }
});

test('a failed native start shows a restart instruction instead of remaining on Unlocked', async () => {
  bridge.run.mockResolvedValueOnce('Stopped').mockRejectedValueOnce(new Error('Startup failed')).mockResolvedValueOnce('Failed');
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByText('Start XBT node')));
    expect(screen.getByText(/Close and reopen RedWallet/)).toBeTruthy();
    expect(screen.queryByText('Start XBT node')).toBeNull();
    screen.unmount();
  } finally {
    bridge.run.mockResolvedValue('Running');
  }
});

test('saved custom peer is shown and reused without switching to automatic peers', async () => {
  bridge.peer.mockResolvedValueOnce('192.168.1.5:8333');
  bridge.run.mockResolvedValueOnce('Stopped').mockResolvedValue('Needs setup');
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    expect(screen.getByLabelText('Optional XBT chain peer').props.value).toBe('192.168.1.5:8333');
    await act(async () => fireEvent.press(screen.getByText('Start XBT node')));
    expect(bridge.run).toHaveBeenCalledWith('start', '192.168.1.5:8333');
    screen.unmount();
  } finally {
    bridge.run.mockResolvedValue('Running');
  }
});

test('unreadable peer settings do not silently start with public defaults', async () => {
  bridge.run.mockClear();
  bridge.run.mockResolvedValue('Stopped');
  bridge.peer.mockRejectedValueOnce(new Error('Unreadable settings'));
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    expect(screen.getByText(/Could not read node status or saved peer settings/)).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('Refresh status')));
    fireEvent.press(screen.getByText('Start XBT node'));
    expect(bridge.run.mock.calls.some(call => call[0] === 'start')).toBe(false);
    screen.unmount();
  } finally {
    bridge.run.mockResolvedValue('Running');
  }
});

test('activity stays in the sticky panel and reports a pending operation followed by its full copyable result', async () => {
  const screen = render(<XBTLightning />);
  await act(async () => {});
  const panel = within(screen.getByTestId('LightningActivityPanel'));
  expect(screen.getByTestId('XBTLightningScreen').props.stickyHeaderIndices).toEqual([1]);
  expect(screen.getByText('Fee rate (sat/vB)')).toBeTruthy();
  expect(screen.getByPlaceholderText('Paste a Lightning invoice')).toBeTruthy();
  let finish!: (value: string) => void;
  bridge.run.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  fireEvent.press(screen.getByText('Get XBT funding address'));
  expect(panel.getByText('Working…')).toBeTruthy();
  expect(panel.getByText('XBT funding address')).toBeTruthy();
  expect(panel.queryByLabelText('Copy activity result')).toBeNull();
  const result = 'bc1q' + 'x'.repeat(60);
  await act(async () => finish(result));
  expect(panel.getByText(result)).toBeTruthy();
  expect(screen.getAllByText(result)).toHaveLength(1);
  fireEvent.press(panel.getByLabelText('Copy activity result'));
  expect(Clipboard.setString).toHaveBeenLastCalledWith(result);
  expect(panel.getByText('Copied')).toBeTruthy();
  screen.unmount();
});

test('a failed operation replaces the previous result visibly in the activity panel', async () => {
  const screen = render(<XBTLightning />);
  await act(async () => {});
  bridge.run.mockResolvedValueOnce('Old payment history');
  await act(async () => fireEvent.press(screen.getByText('Recent payments')));
  bridge.run.mockRejectedValueOnce(new Error('Peer disconnected'));
  await act(async () => fireEvent.press(screen.getByText('Get XBT funding address')));
  const panel = within(screen.getByTestId('LightningActivityPanel'));
  expect(panel.getByText('XBT funding address · Error')).toBeTruthy();
  expect(panel.getByText('Peer disconnected')).toBeTruthy();
  expect(screen.queryByText('Old payment history')).toBeNull();
  screen.unmount();
});

test('created receive invoices and empty channel results are surfaced in the activity panel', async () => {
  const screen = render(<XBTLightning />);
  await act(async () => {});
  const panel = within(screen.getByTestId('LightningActivityPanel'));
  fireEvent.changeText(screen.getByLabelText('Sats to receive'), '500');
  bridge.invoice.mockResolvedValueOnce('ln-xbt-invoice' as never);
  await act(async () => fireEvent.press(screen.getByText('Create invoice')));
  expect(panel.getByText('Invoice ready to receive 500 sats. QR code below.')).toBeTruthy();
  expect(screen.getByText('Receive 500 sats')).toBeTruthy();
  bridge.manage.mockResolvedValueOnce([]);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Refresh channels' })));
  expect(panel.getByText('No open or pending channels.')).toBeTruthy();
  expect(panel.queryByText('ln-xbt-invoice')).toBeNull();
  screen.unmount();
});

test('channel summary separates open, active, pending and closing and never offers to close pending channels', async () => {
  bridge.manage.mockResolvedValueOnce([
    {
      point: 'active:0',
      peer: 'peer-a',
      state: 'active',
      active: true,
      localSats: '80000',
    },
    {
      point: 'inactive:0',
      peer: 'peer-b',
      state: 'inactive',
      active: false,
      localSats: '70000',
    },
    {
      point: 'pending:0',
      peer: 'peer-c',
      state: 'pending',
      active: false,
      localSats: '90000',
      confirmationsRemaining: 2,
    },
    {
      point: 'closing:0',
      peer: 'peer-d',
      state: 'closing',
      active: false,
      localSats: '60000',
    },
  ]);
  const screen = render(<XBTLightning />);
  await act(async () => {});
  const summary = within(screen.getByTestId('LightningChannelSummary'));
  expect(summary.getByText('Channels · 2 open')).toBeTruthy();
  expect(summary.getByText('1 active · 1 inactive\n1 pending · 1 closing')).toBeTruthy();
  expect(screen.getByText('Pending · 2 confirmation(s) remaining')).toBeTruthy();
  expect(screen.queryByText('Close channel · 90000 local sats')).toBeNull();
  expect(screen.queryByText('Close channel · 60000 local sats')).toBeNull();
  screen.unmount();
});

test('automatic channel refresh promotes pending to active without replacing the action result', async () => {
  jest.useFakeTimers();
  bridge.manage.mockResolvedValueOnce([
    {
      point: 'same:0',
      peer: 'peer-a',
      state: 'pending',
      active: false,
      localSats: '90000',
    },
  ]);
  const screen = render(<XBTLightning />);
  try {
    await act(async () => {});
    const summary = within(screen.getByTestId('LightningChannelSummary'));
    expect(summary.getByText('Channels · 0 open')).toBeTruthy();
    bridge.run.mockResolvedValueOnce('bc1q-funding-result');
    await act(async () => fireEvent.press(screen.getByText('Get XBT funding address')));
    bridge.manage.mockResolvedValueOnce([
      {
        point: 'same:0',
        peer: 'peer-a',
        state: 'active',
        active: true,
        localSats: '90000',
      },
    ]);
    await act(async () => jest.advanceTimersByTime(15000));
    expect(summary.getByText('Channels · 1 open')).toBeTruthy();
    expect(summary.getByText('1 active · 0 inactive\n0 pending · 0 closing')).toBeTruthy();
    expect(within(screen.getByTestId('LightningActivityPanel')).getByText('bc1q-funding-result')).toBeTruthy();
  } finally {
    screen.unmount();
    jest.useRealTimers();
  }
});

test('failed channel refresh preserves last known counts and distinguishes unavailable data from zero', async () => {
  bridge.manage.mockRejectedValueOnce(new Error('Unavailable'));
  const screen = render(<XBTLightning />);
  await act(async () => {});
  const summary = within(screen.getByTestId('LightningChannelSummary'));
  expect(summary.getByText('Channel count unavailable. Tap Refresh channels to retry.')).toBeTruthy();
  expect(summary.queryByText('Channels · 0 open')).toBeNull();
  bridge.manage.mockResolvedValueOnce([
    {
      point: 'active:0',
      peer: 'peer-a',
      state: 'active',
      active: true,
      localSats: '80000',
    },
  ]);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Refresh channels' })));
  bridge.manage.mockRejectedValueOnce(new Error('Disconnected'));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Refresh channels' })));
  expect(summary.getByText('Channels · 1 open')).toBeTruthy();
  expect(summary.getByText('Last known counts · Refresh failed')).toBeTruthy();
  screen.unmount();
});

test('returning to the foreground refreshes channels', async () => {
  const subscribe = jest.mocked(AppState.addEventListener);
  subscribe.mockClear();
  const screen = render(<XBTLightning />);
  try {
    await act(async () => {});
    const listener = subscribe.mock.calls.find(call => call[0] === 'change')![1];
    bridge.manage.mockResolvedValueOnce([
      {
        point: 'ready:0',
        peer: 'peer-a',
        state: 'active',
        active: true,
        localSats: '80000',
      },
    ]);
    await act(async () => listener('active'));
    expect(within(screen.getByTestId('LightningChannelSummary')).getByText('Channels · 1 open')).toBeTruthy();
  } finally {
    screen.unmount();
    subscribe.mockClear();
  }
});

test('Tor-only Lightning peers get an explicit explanation before any connection attempt', async () => {
  const screen = render(<XBTLightning />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Lightning peer'), '02fixture@example.onion:9735');
  bridge.invoice.mockClear();
  await act(async () => fireEvent.press(screen.getByText('Connect Lightning peer')));
  expect(
    within(screen.getByTestId('LightningActivityPanel')).getByText(
      'Tor-only Lightning peers are not supported by this build. Use a reachable IP or DNS address for the same XBT network.',
    ),
  ).toBeTruthy();
  expect(bridge.invoice).not.toHaveBeenCalled();
  screen.unmount();
});

test('receiving captures the requested amount and leaves a scrollable compact invoice screen', async () => {
  let finish!: (invoice: string) => void;
  bridge.invoice.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const screen = render(<XBTLightning />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Sats to receive'), '1000');
  await act(async () => {
    fireEvent.press(screen.getByText('Create invoice'));
  });
  fireEvent.changeText(screen.getByLabelText('Sats to receive'), '2000');
  const invoice = 'lnbc10u1' + 'q'.repeat(800);
  await act(async () => finish(invoice));
  expect(screen.getByText('Receive 1000 sats')).toBeTruthy();
  expect(screen.queryByText(invoice)).toBeNull();
  expect(screen.getByText('Copy invoice')).toBeTruthy();
  expect(screen.getByPlaceholderText('Paste a Lightning invoice')).toBeTruthy();
  expect(screen.getByTestId('XBTLightningScreen').props.keyboardDismissMode).toBe('on-drag');
  expect(screen.getByTestId('XBTLightningScreen').props.keyboardShouldPersistTaps).toBe('handled');
  expect(screen.getByText('Export encrypted Lightning recovery file')).toBeTruthy();
  screen.unmount();
});

test.each([
  ['pay', 'Review invoice', 'Create invoice', 'Withdrawal address'],
  ['invoice', 'Create invoice', 'Review invoice', 'Withdrawal address'],
  ['send', 'Review withdrawal', 'Create invoice', 'Invoice to pay'],
  ['receive', 'Get XBT funding address', 'Review invoice', 'Withdrawal address'],
])('focused %s route exposes only the selected task and retains foreground activity', async (mode, shown, hidden, hiddenInput) => {
  const screen = render(<XBTLightning route={{ params: { mode } }} />);
  await act(async () => {});
  expect(screen.getByText(shown)).toBeTruthy();
  expect(screen.queryByText(hidden)).toBeNull();
  expect(screen.queryByLabelText(hiddenInput)).toBeNull();
  expect(screen.queryByText('Open private channel')).toBeNull();
  expect(screen.queryByText('Export encrypted Lightning recovery file')).toBeNull();
  expect(screen.getByTestId('LightningActivityPanel')).toBeTruthy();
  screen.unmount();
});

test('camera invoice scan fills the field and clears old review without submitting payment', async () => {
  const screen = render(<XBTLightning route={{ params: { mode: 'pay' } }} />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Invoice to pay'), 'lnbc-old');
  await act(async () => fireEvent.press(screen.getByText('Review invoice')));
  expect(screen.getByText('Pay 500 sats')).toBeTruthy();
  bridge.invoice.mockClear();
  fireEvent.press(screen.getByText('Scan invoice QR'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('ScanQRCode', expect.objectContaining({ onBarScanned: expect.any(Function) }));
  const scan = mockNavigation.navigate.mock.calls.at(-1)![1].onBarScanned;
  act(() => scan('LIGHTNING:LNBC10U1QQQQ'));
  expect(screen.getByLabelText('Invoice to pay').props.value).toBe('lnbc10u1qqqq');
  expect(screen.queryByText('Pay 500 sats')).toBeNull();
  expect(bridge.invoice).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('Review invoice')));
  expect(bridge.invoice).toHaveBeenCalledWith('decode', 'lnbc10u1qqqq', '', '');
  screen.unmount();
});

test('camera scan rejects unrelated QR data without replacing the invoice or paying', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<XBTLightning route={{ params: { mode: 'pay' } }} />);
  await act(async () => {});
  bridge.invoice.mockClear();
  fireEvent.press(screen.getByText('Scan invoice QR'));
  const scan = mockNavigation.navigate.mock.calls.at(-1)![1].onBarScanned;
  act(() => scan('https://example.com'));
  expect(prompt).toHaveBeenCalledWith('Not a Lightning invoice', expect.any(String));
  expect(screen.getByLabelText('Invoice to pay').props.value).toBe('');
  expect(bridge.invoice).not.toHaveBeenCalled();
  screen.unmount();
  prompt.mockRestore();
});

test('channel selection exposes the correct peer and scopes actions even for two channels with one peer', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  bridge.manage.mockResolvedValueOnce([
    {
      point: 'first:0',
      peer: 'same-peer',
      peerAlias: 'Example',
      peerAddress: 'example.onion:9735',
      state: 'active',
      active: true,
      localSats: '1000',
    },
    {
      point: 'second:0',
      peer: 'same-peer',
      state: 'active',
      active: true,
      localSats: '2000',
    },
  ]);
  const screen = render(<XBTLightning />);
  try {
    await act(async () => {});
    expect(screen.queryByText('Close channel · 1000 local sats')).toBeNull();
    fireEvent.press(screen.getByTestId('SelectChannel-first:0'));
    expect(within(screen.getByTestId('LightningActivityPanel')).getByText(/Current peer address: example.onion:9735/)).toBeTruthy();
    fireEvent.press(screen.getByText('Close channel · 1000 local sats'));
    const confirm = prompt.mock.calls[0][2]!.find(button => button.text === 'Close channel')!.onPress!;
    expect(prompt.mock.calls[0][1]).toContain('Channel: first:0');
    fireEvent.press(screen.getByTestId('SelectChannel-second:0'));
    expect(screen.queryByText('Close channel · 1000 local sats')).toBeNull();
    expect(screen.getByText('Close channel · 2000 local sats')).toBeTruthy();
    expect(within(screen.getByTestId('LightningActivityPanel')).getByText(/Channel funding reference: second:0/)).toBeTruthy();
    bridge.manage.mockClear();
    await act(async () => confirm());
    expect(bridge.manage.mock.calls.some(call => call[0] === 'close')).toBe(false);
    bridge.manage.mockResolvedValueOnce([]);
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Refresh channels' })));
    expect(screen.queryByText('Close channel · 2000 local sats')).toBeNull();
  } finally {
    screen.unmount();
    prompt.mockRestore();
  }
});

test('switching channels clears resize inputs and reviews instead of retargeting them', async () => {
  const splice = jest.fn();
  NativeModules.XBTLightningBridge.splice = splice;
  bridge.manage.mockResolvedValueOnce([
    {
      point: 'resize-a:0',
      peer: 'peer',
      state: 'active',
      active: true,
      localSats: '1000',
      splice: { status: 'ok' },
    },
    {
      point: 'resize-b:0',
      peer: 'peer',
      state: 'active',
      active: true,
      localSats: '2000',
      splice: { status: 'ok' },
    },
  ]);
  const screen = render(<XBTLightning />);
  try {
    await act(async () => {});
    fireEvent.press(screen.getByTestId('SelectChannel-resize-a:0'));
    fireEvent.press(screen.getByText('Add funds'));
    fireEvent.changeText(screen.getByLabelText('Channel resize sats'), '1000');
    fireEvent.press(screen.getByTestId('SelectChannel-resize-b:0'));
    expect(screen.queryByTestId('ChannelFunds-resize-a:0')).toBeNull();
    expect(screen.getByTestId('ChannelFunds-resize-b:0')).toBeTruthy();
    expect(screen.queryByLabelText('Channel resize sats')).toBeNull();
    fireEvent.press(screen.getByTestId('SelectChannel-resize-a:0'));
    fireEvent.press(screen.getByText('Add funds'));
    expect(screen.getByLabelText('Channel resize sats').props.value).toBe('');
    expect(splice).not.toHaveBeenCalled();
  } finally {
    screen.unmount();
    delete NativeModules.XBTLightningBridge.splice;
  }
});

test('large invoice and withdrawal amounts reach native validation without an app ceiling', async () => {
  const screen = render(<XBTLightning />);
  await act(async () => {});
  bridge.invoice.mockClear();
  fireEvent.changeText(screen.getByLabelText('Sats to receive'), '44000000');
  await act(async () => fireEvent.press(screen.getByText('Create invoice')));
  expect(bridge.invoice).toHaveBeenCalledWith('receive', '', '', '44000000');
  bridge.manage.mockClear();
  fireEvent.changeText(screen.getByLabelText('Withdrawal address'), 'bc1q-fixture');
  fireEvent.changeText(screen.getByLabelText('Withdrawal sats'), '44000000');
  fireEvent.changeText(screen.getByLabelText('On-chain fee rate'), '250');
  await act(async () => fireEvent.press(screen.getByText('Review withdrawal')));
  expect(bridge.manage).toHaveBeenCalledWith('withdrawReview', 'bc1q-fixture', '44000000', '250');
  expect(bridge.manage.mock.calls.some(call => call[0] === 'withdraw')).toBe(false);
  screen.unmount();
});
test('channel creation binds the chosen large amount and fee to confirmation', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    bridge.invoice.mockClear();
    fireEvent.changeText(screen.getByLabelText('Lightning peer'), 'peer@host:9735');
    for (const amount of ['10000001', '44000000']) {
      fireEvent.changeText(screen.getByLabelText('New channel sats'), amount);
      fireEvent.press(screen.getByText('Open private channel'));
    }
    expect(prompt).not.toHaveBeenCalled();
    expect(bridge.invoice).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('New channel sats'), '10000000');
    fireEvent.changeText(screen.getByLabelText('New channel fee rate'), '250');
    fireEvent.press(screen.getByText('Open private channel'));
    expect(bridge.invoice).not.toHaveBeenCalled();
    const [, detail, buttons] = prompt.mock.calls[prompt.mock.calls.length - 1];
    expect(detail).toContain('10000000 sats at 250 sat/vB');
    fireEvent.changeText(screen.getByLabelText('New channel sats'), '50000000');
    const confirm = buttons!.find(button => button.text === 'Open channel')!.onPress!;
    await act(async () => {
      confirm();
      confirm();
    });
    expect(bridge.invoice.mock.calls).toEqual([['open', 'peer', '250', '10000000']]);
    screen.unmount();
  } finally {
    prompt.mockRestore();
  }
});
test('editable routing fee is confirmed with the invoice and cannot change after review', async () => {
  const payInvoice = jest.fn().mockResolvedValue(true);
  Object.assign(bridge, { payInvoice });
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('Invoice to pay'), 'lnbcrt-fixture');
    fireEvent.changeText(screen.getByLabelText('Maximum routing fee sats'), '250');
    await act(async () => fireEvent.press(screen.getByText('Review invoice')));
    fireEvent.press(screen.getByText('Pay 500 sats'));
    const [, detail, buttons] = prompt.mock.calls[prompt.mock.calls.length - 1];
    expect(detail).toContain('Maximum routing fee: 250 sats');
    fireEvent.changeText(screen.getByLabelText('Maximum routing fee sats'), '500');
    expect(screen.queryByText('Pay 500 sats')).toBeNull();
    const confirm = buttons!.find(button => button.text === 'Pay')!.onPress!;
    await act(async () => {
      confirm();
      confirm();
    });
    expect(payInvoice.mock.calls).toEqual([['lnbcrt-fixture', 'reviewed-hash', '500', '250']]);
    screen.unmount();
  } finally {
    prompt.mockRestore();
    delete (bridge as typeof bridge & { payInvoice?: unknown }).payInvoice;
  }
});

test.each(['pay', 'withdraw', 'open', 'close'])('declined authentication prevents %s submission', async operation => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const previousManage = bridge.manage.getMockImplementation();
  const previousInvoice = bridge.invoice.getMockImplementation();
  bridge.run.mockResolvedValue('Running');
  bridge.manage.mockImplementation(async action =>
    action === 'channelStatus'
      ? [
          {
            point: 'auth-channel:0',
            peer: 'auth-peer',
            state: 'active',
            active: true,
            localSats: '100000',
          },
        ]
      : action === 'withdrawReview'
        ? {
            token: 'auth-token',
            address: 'bc1q-fixture',
            sats: '1000',
            feeRate: '1',
          }
        : 'txid',
  );
  bridge.invoice.mockImplementation(async action => (action === 'decode' ? { sats: '500', destination: 'peer', hash: 'auth-hash' } : true));
  const s = render(<XBTLightning />);
  try {
    await act(async () => {});
    mockAuthorize.mockResolvedValue(false);
    if (operation === 'pay') {
      fireEvent.changeText(s.getByLabelText('Invoice to pay'), 'lnbcrt-fixture');
      await act(async () => fireEvent.press(s.getByText('Review invoice')));
      fireEvent.press(s.getByText('Pay 500 sats'));
    } else if (operation === 'withdraw') {
      fireEvent.changeText(s.getByLabelText('Withdrawal address'), 'bc1q-fixture');
      fireEvent.changeText(s.getByLabelText('Withdrawal sats'), '1000');
      await act(async () => fireEvent.press(s.getByText('Review withdrawal')));
      fireEvent.press(s.getByText('Withdraw 1000 sats'));
    } else if (operation === 'open') {
      fireEvent.changeText(s.getByLabelText('Lightning peer'), 'peer@host:9735');
      fireEvent.press(s.getByText('Open private channel'));
    } else {
      fireEvent.press(s.getByTestId('SelectChannel-auth-channel:0'));
      fireEvent.press(s.getByText('Close channel · 100000 local sats'));
    }
    bridge.invoice.mockClear();
    bridge.manage.mockClear();
    const buttons = alert.mock.calls.at(-1)![2]!;
    const approve = buttons.find(
      button =>
        button.text ===
        {
          pay: 'Pay',
          withdraw: 'Withdraw',
          open: 'Open channel',
          close: 'Close channel',
        }[operation],
    )!.onPress!;
    await act(async () => {
      approve();
      approve();
    });
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
    expect(bridge.invoice).not.toHaveBeenCalled();
    expect(bridge.manage.mock.calls.some(call => call[0] === 'withdraw' || call[0] === 'close')).toBe(false);
    expect(s.getByText('Action canceled. Nothing was submitted.')).toBeTruthy();
  } finally {
    s.unmount();
    alert.mockRestore();
    bridge.manage.mockImplementation(previousManage!);
    bridge.invoice.mockImplementation(previousInvoice!);
  }
});

test('backup export uses secret reauthentication and a declined prompt never reaches native export', async () => {
  const s = render(<XBTLightning />);
  try {
    await act(async () => {});
    bridge.run.mockClear();
    mockAuthorizeExport.mockResolvedValue(false);
    await act(async () => fireEvent.press(s.getByText('Export static channel backup')));
    expect(mockAuthorizeExport).toHaveBeenCalledTimes(1);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(bridge.run).not.toHaveBeenCalled();
  } finally {
    s.unmount();
  }
});

test('authentication resolving after the screen is dismissed cannot submit a payment', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let finish!: (value: boolean) => void;
  mockAuthorize.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const s = render(<XBTLightning />);
  try {
    await act(async () => {});
    fireEvent.changeText(s.getByLabelText('Invoice to pay'), 'lnbcrt-fixture');
    await act(async () => fireEvent.press(s.getByText('Review invoice')));
    fireEvent.press(s.getByText('Pay 500 sats'));
    bridge.invoice.mockClear();
    await act(async () => {
      alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Pay')!.onPress!();
    });
    s.unmount();
    await act(async () => finish(true));
    expect(bridge.invoice).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});
