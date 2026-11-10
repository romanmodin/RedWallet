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
  expect(result.lightningAvailable).toBe(95000);
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
  expect(screen.getAllByText('••••')).toHaveLength(7);
  expect(screen.queryByText('1000000')).toBeNull();
  expect(screen.getByText('BALANCE DETAILS · LAST OBSERVED')).toBeTruthy();
});

jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
