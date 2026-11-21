import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { encode, sign } from 'bolt11';
import { AppState, AppStateStatus } from 'react-native';
import CrossChainLightning from '../../components/CrossChainLightning';
import { BridgeController, BridgeHistoryEntry, SwapRecord } from '../../blue_modules/lightning-bridge/state';
import { LightningBridgeProvider } from '../../blue_modules/lightning-bridge/provider';

jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
jest.mock('../../blue_modules/lightning-bridge/runtime', () => ({ crossChainBridge: {} }));
const now = 1800000000000;
const original = sign(
  encode({
    timestamp: now / 1000,
    satoshis: 100,
    tags: [
      { tagName: 'payment_hash', data: '11'.repeat(32) },
      { tagName: 'description', data: 'UI fixture' },
    ],
  }),
  '01'.padStart(64, '0'),
).paymentRequest!;
const item: SwapRecord = {
  hash: '11'.repeat(32),
  node: '02' + '22'.repeat(32),
  provider: 'second',
  state: 'quoted',
  createdAt: now,
  updatedAt: now,
  feeLimit: '10',
  estimatedFeeMsat: '1500',
  quote: {
    provider: 'second',
    hash: '11'.repeat(32),
    original,
    originalMsat: '100000',
    holdInvoice: 'signed-hold-fixture',
    payMsat: '102000000',
    paySat: '102000',
    rate: 0.001,
    spread: 0.02,
    expiresAt: now / 1000 + 120,
    token: 'ab'.repeat(16),
    destination: '02' + '33'.repeat(32),
    cltv: 1200,
  },
};
const providers = [
  { id: 'first', name: 'Processor one', website: 'https://one.invalid' },
  { id: 'second', name: 'Processor two', website: 'https://two.invalid' },
] as LightningBridgeProvider[];
function setup(
  props: Partial<React.ComponentProps<typeof CrossChainLightning>> = {},
  entries: BridgeHistoryEntry[] = [{ hash: item.hash, at: item.createdAt, record: item, issues: [] }],
) {
  const fake = {
    quote: jest.fn(async () => item),
    approve: jest.fn<ReturnType<BridgeController['approve']>, Parameters<BridgeController['approve']>>(async () => ({
      ...item,
      state: 'pending',
    })),
    cancel: jest.fn(async () => undefined),
    list: jest.fn(async () => [item]),
    history: jest.fn(async () => entries),
    refresh: jest.fn(async () => item),
  };
  const close = jest.fn(),
    authorize = jest.fn(async (action: (isCurrent: () => boolean) => Promise<void>) => {
      await action(() => true);
      return true;
    });
  const view = render(
    <CrossChainLightning
      invoice={original}
      feeLimit="10"
      providers={providers}
      controller={fake as unknown as BridgeController}
      onClose={close}
      authorize={authorize}
      {...props}
    />,
  );
  return { view, fake, close, authorize };
}
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(now);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(() => jest.restoreAllMocks());

test('processor selection occurs before any quote; only the chosen processor is contacted', async () => {
  const { view, fake, close, authorize } = setup();
  expect(view.getByText('Choose Lightning processor')).toBeTruthy();
  expect(fake.quote).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Processor two'));
  expect(fake.quote).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  expect(fake.quote).toHaveBeenCalledTimes(1);
  expect((fake.quote.mock.calls as unknown as [string][])[0][0]).toBe('second');
  expect(view.getByText('Processor: Processor two')).toBeTruthy();
  expect(view.getByText(/Maximum total XBT required: 0.0010201 XBT/)).toBeTruthy();
  expect(view.getByText(/Estimated routing fee.*1.5 XBT sats/)).toBeTruthy();
  expect(fake.approve).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(fake.approve).toHaveBeenCalledTimes(1);
  expect(view.getByText(/Payment pending or uncertain/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'Close · payment remains tracked' })));
  expect(fake.cancel).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
});
test('canceling a quote never invokes payment or authentication', async () => {
  const { view, fake, close, authorize } = setup();
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'Cancel / Close' })));
  expect(fake.cancel).toHaveBeenCalledWith(item.hash);
  expect(fake.approve).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  view.unmount();
});
test('canceled authentication and background state cannot approve a payment', async () => {
  const { view, fake } = setup({ authorize: async () => false });
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(fake.approve).not.toHaveBeenCalled();
  expect(view.getByText('Action canceled. Nothing was submitted.')).toBeTruthy();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(fake.approve).not.toHaveBeenCalled();
  view.unmount();
});
test('leaving and returning to the app during payment checks cannot revive approval', async () => {
  let notify = (_state: AppStateStatus) => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    notify = listener;
    return { remove: jest.fn() };
  });
  let finishChecks!: () => void;
  const checks = new Promise<void>(resolve => {
    finishChecks = resolve;
  });
  const { view, fake } = setup();
  fake.approve.mockImplementationOnce(async (_hash, _invoice, canSubmit) => {
    await checks;
    return { ...item, state: canSubmit() ? 'pending' : 'canceled' };
  });
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  await act(async () => {
    fireEvent.press(view.getByText('Confirm and pay'));
  });
  expect(fake.approve).toHaveBeenCalledTimes(1);
  expect(fake.approve.mock.calls[0][2]()).toBe(true);
  expect(view.getByRole('button', { name: 'Cancel / Close' })).toBeDisabled();
  await act(async () => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    notify('background');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    notify('active');
    finishChecks();
  });
  expect(view.getByText('Canceled before submission. No payment sent.')).toBeTruthy();
  expect(view.queryByText(/Payment pending or uncertain/)).toBeNull();
  view.unmount();
});

test('reopening history exposes pending status and masks invoice and amounts when hidden', async () => {
  const { view, fake } = setup({ invoice: undefined, initialHash: item.hash, hideHistoryAmounts: true, authorize: undefined });
  await act(async () => {});
  expect(fake.history).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Confirm and pay')).toBeNull();
  expect(view.getByText('Original invoice: ••••')).toBeTruthy();
  expect(view.queryByText(original)).toBeNull();
  expect(fake.approve).not.toHaveBeenCalled();
  view.unmount();
});

test('approval errors remain visible and replace stale review with durable pending state', async () => {
  const { view, fake } = setup();
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  fake.approve.mockRejectedValueOnce(new Error('Keychain locked after dispatch'));
  fake.list.mockResolvedValueOnce([{ ...item, state: 'submitting' }]);
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(view.getByText('Keychain locked after dispatch')).toBeTruthy();
  expect(view.getByText(/Payment pending or uncertain/)).toBeTruthy();
  expect(view.queryByText('Confirm and pay')).toBeNull();
  expect(fake.approve).toHaveBeenCalledTimes(1);
  view.unmount();
});
test('an unreadable journal after an approval error never leaves a Pay button visible', async () => {
  const { view, fake } = setup();
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  fake.approve.mockRejectedValueOnce(new Error('Storage locked'));
  fake.list.mockRejectedValueOnce(new Error('Storage locked'));
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(view.getByText(/Payment pending or uncertain/)).toBeTruthy();
  expect(view.queryByText('Confirm and pay')).toBeNull();
  expect(fake.approve).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('history shows saved processor and time for an old incomplete quote without inventing a reason', async () => {
  const partial: SwapRecord = {
    ...item,
    state: 'quote_failed',
    quote: undefined,
  };
  const { view, fake } = setup({ invoice: undefined }, [{ hash: item.hash, at: now, record: partial, issues: [] }]);
  await act(async () => {});
  fireEvent.press(view.getByText('XBT → SHA-256 · quote_failed'));
  expect(view.getByText('Cross-chain payment details')).toBeTruthy();
  expect(view.getByText('Processor: Processor two')).toBeTruthy();
  expect(view.getByText('Time: ' + new Date(now).toLocaleString())).toBeTruthy();
  expect(view.getByText('No further details were saved for this attempt.')).toBeTruthy();
  expect(view.queryByText('Check settlement')).toBeNull();
  expect(view.queryByText('Confirm and pay')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('Back to history')));
  expect(view.getByText('Cross-chain Lightning history')).toBeTruthy();
  expect(fake.approve).not.toHaveBeenCalled();
  view.unmount();
});

test('a pre-quote refusal has readable history even without a swap; hidden dates and identifiers stay private', async () => {
  const issue = {
    hash: item.hash,
    node: item.node,
    provider: item.provider,
    at: now,
    reason: 'processorRefused' as const,
  };
  const { view, fake } = setup({ invoice: undefined, initialHash: item.hash, hideHistoryAmounts: true }, [
    { hash: item.hash, at: now, issues: [issue] },
  ]);
  await act(async () => {});
  expect(view.getByText('Processor two · ••••')).toBeTruthy();
  expect(view.getByText('The processor was unavailable or refused the request.')).toBeTruthy();
  expect(view.queryByText(/Quote ready|Confirm and pay|Check settlement/)).toBeNull();
  expect(view.queryByText(new RegExp(item.hash))).toBeNull();
  expect(view.queryByText(new Date(now).toLocaleString())).toBeNull();
  expect(fake.quote).not.toHaveBeenCalled();
  expect(fake.approve).not.toHaveBeenCalled();
  view.unmount();
});
