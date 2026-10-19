import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { CoinjoinPreview } from '../../screen/settings/CoinjoinExperimental';
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
afterEach(cleanup);
it('shows sample values, recalculates change, and never offers live signing', () => {
  const screen = render(<CoinjoinPreview />);
  expect(screen.getByTestId('CoinjoinOfflineNotice')).toHaveTextContent('Offline preview · Sample coins only. No real coins are used.');
  expect(screen.getByText('39,729 sats')).toBeTruthy();
  fireEvent.press(screen.getByTestId('CoinjoinChooseSample'));
  expect(screen.getByText('49,729 sats')).toBeTruthy();
  fireEvent.press(screen.getByTestId('CoinjoinReviewSample'));
  expect(screen.getByTestId('CoinjoinSignDisabled')).toBeDisabled();
  expect(screen.getByTestId('CoinjoinReviewNotice')).toHaveTextContent(
    'This is a demonstration. No real coins are reserved, signed, or sent.',
  );
  fireEvent.press(screen.getByTestId('CoinjoinSignDisabled'));
  expect(screen.getByTestId('CoinjoinSignDisabled')).toBeDisabled();
});
