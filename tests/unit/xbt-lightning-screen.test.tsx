import Clipboard from '@react-native-clipboard/clipboard';
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { Alert, AppState, NativeModules } from 'react-native';

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
