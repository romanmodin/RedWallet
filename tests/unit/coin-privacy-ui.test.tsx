import React from 'react';
import { Alert } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import CoinPrivacyBadge from '../../components/CoinPrivacyBadge';
import confirmCoinPrivacy from '../../components/confirmCoinPrivacy';
import loc from '../../loc';
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test.each(['mixed', 'pending', 'change', 'unknown'] as const)('%s badge exposes a text label for accessibility', status => {
  const screen = render(<CoinPrivacyBadge status={status} />);
  const badge = screen.getByTestId(`CoinPrivacy-${status}`);
  expect(badge.props.accessibilityLabel).toBeTruthy();
  expect(screen.getByText(badge.props.accessibilityLabel)).toBeTruthy();
});

test('change badge reflects the actual frozen state', () => {
  const screen = render(<CoinPrivacyBadge status="change" frozen />);
  expect(screen.getByText(loc.cc.privacy_change_frozen)).toBeTruthy();
  screen.rerender(<CoinPrivacyBadge status="change" frozen={false} />);
  expect(screen.getByText(loc.cc.privacy_change)).toBeTruthy();
});

test('warning defaults to choosing again or dismissal; only explicit continue approves', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const cancelled = confirmCoinPrivacy();
  alert.mock.calls[0][2]![0].onPress!();
  expect(await cancelled).toBe(false);
  const dismissed = confirmCoinPrivacy();
  alert.mock.calls[1][3]!.onDismiss!();
  expect(await dismissed).toBe(false);
  const approved = confirmCoinPrivacy();
  alert.mock.calls[2][2]![1].onPress!();
  expect(await approved).toBe(true);
});
