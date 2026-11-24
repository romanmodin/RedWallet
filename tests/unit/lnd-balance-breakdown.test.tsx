import React from 'react';
import { render, screen } from '@testing-library/react-native';
import LndBalanceBreakdown from '../../components/LndBalanceBreakdown';
import { lndBalanceBreakdown } from '../../blue_modules/lnd-balance-breakdown';
import { LndOverview } from '../../class/wallets/lnd-wallet';

const overview: LndOverview = {
  node: 'test',
  synced: true,
  height: '1',
  peers: '1',
  activeChannels: '1',
  fundingTotal: '60000',
  fundingConfirmed: '50000',
  fundingPending: '10000',
  fundingLocked: '2000',
  anchorReserve: '3000',
  lightningLocal: '99056',
  lightningRemote: '20000',
  channelPending: '7000',
  splicePending: '1000000',
  lightningAvailable: '95000',
};
test('keeps pending and reserved amounts separate; locked outputs are not deducted twice', () => {
  const result = lndBalanceBreakdown(overview);
  expect(result.onchainAvailable).toBe(47000);
  expect(result.channelBalance).toBe(99056);
  expect(result.lightningAvailable).toBe(95000);
  expect(result.channelUnavailable).toBe(4056);
  expect(result.splicePending).toBe(1000000);
  expect(result.fundingLocked).toBe(2000);
  expect(lndBalanceBreakdown({ ...overview, fundingConfirmed: '1000' }).onchainAvailable).toBe(0);
  expect(lndBalanceBreakdown({ ...overview, lightningAvailable: undefined }).lightningAvailable).toBeUndefined();
});
test.each(['-1', '1.5', 'NaN', '9007199254740992'])('refuses invalid balance %s', value => {
  expect(() => lndBalanceBreakdown({ ...overview, fundingLocked: value })).toThrow();
});
test('masks every amount and marks cached data as last observed', () => {
  render(<LndBalanceBreakdown overview={overview} hidden stale format={value => value.toString()} />);
  expect(screen.getAllByText('••••')).toHaveLength(9);
  expect(screen.queryByText('99056')).toBeNull();
  expect(screen.queryByText('1000000')).toBeNull();
  expect(screen.getByText('Balance Details · Last Observed')).toBeTruthy();
});

test('cached channel funds remain visible while the current ability to send is unknown', () => {
  render(<LndBalanceBreakdown overview={overview} hidden={false} stale format={value => value + ' sats'} />);
  expect(screen.getByText('99056 sats')).toBeTruthy();
  expect(screen.queryByText('95000 sats')).toBeNull();
  expect(screen.getAllByText('Refresh node')).toHaveLength(2);
  expect(screen.getByText(/Last reported by your node/)).toBeTruthy();
});

test('offline channels retain the local balance and zero spendable liquidity', () => {
  const offline = { ...overview, activeChannels: '0', lightningAvailable: '0' };
  const result = lndBalanceBreakdown(offline);
  expect(result.channelBalance).toBe(99056);
  expect(result.channelUnavailable).toBe(99056);
  expect(result.onchainAvailable).toBe(47000);
  render(<LndBalanceBreakdown overview={offline} hidden={false} stale={false} format={value => value + ' sats'} />);
  expect(screen.getByText('Your balance in channels')).toBeTruthy();
  expect(screen.getByText(/With no active channels/)).toBeTruthy();
  expect(screen.getAllByText('99056 sats')).toHaveLength(2);
  expect(screen.queryByText('20000 sats')).toBeNull();
});

test('missing or inconsistent liquidity never produces a misleading unavailable amount', () => {
  for (const available of [undefined, '100000']) {
    const observed = { ...overview, lightningAvailable: available };
    expect(lndBalanceBreakdown(observed).channelUnavailable).toBeUndefined();
    expect(lndBalanceBreakdown(observed).channelBalance).toBe(99056);
  }
});

jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
