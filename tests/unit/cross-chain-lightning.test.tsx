import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { encode, sign } from 'bolt11';
import { AppState } from 'react-native';
import CrossChainLightning from '../../components/CrossChainLightning';
import { BridgeController, SwapRecord } from '../../blue_modules/lightning-bridge/state';
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
function setup(props: Partial<React.ComponentProps<typeof CrossChainLightning>> = {}) {
  const fake = {
    quote: jest.fn(async () => item),
    approve: jest.fn(async () => ({ ...item, state: 'pending' })),
    cancel: jest.fn(async () => undefined),
    list: jest.fn(async () => [item]),
    refresh: jest.fn(async () => item),
  };
  const close = jest.fn(),
    authorize = jest.fn(async (action: () => Promise<void>) => action());
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
  const { view, fake, authorize } = setup();
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
  view.unmount();
});
test('canceling a quote never invokes payment or authentication', async () => {
  const { view, fake, close, authorize } = setup();
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  await act(async () => fireEvent.press(view.getByText('Cancel / Close')));
  expect(fake.cancel).toHaveBeenCalledWith(item.hash);
  expect(fake.approve).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  view.unmount();
});
test('canceled authentication and background state cannot approve a payment', async () => {
  const { view, fake } = setup({ authorize: async () => undefined });
  fireEvent.press(view.getByLabelText('Processor two'));
  await act(async () => fireEvent.press(view.getByText('Get quote')));
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(fake.approve).not.toHaveBeenCalled();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  await act(async () => fireEvent.press(view.getByText('Confirm and pay')));
  expect(fake.approve).not.toHaveBeenCalled();
  view.unmount();
});
test('reopening history exposes pending status and masks invoice and amounts when hidden', async () => {
  const { view, fake } = setup({ invoice: undefined, initialHash: item.hash, hideHistoryAmounts: true, authorize: undefined });
  await act(async () => {});
  expect(fake.list).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Confirm and pay')).toBeNull();
  expect(view.getByText('Original invoice: ••••')).toBeTruthy();
  expect(view.queryByText(original)).toBeNull();
  expect(fake.approve).not.toHaveBeenCalled();
  view.unmount();
});
