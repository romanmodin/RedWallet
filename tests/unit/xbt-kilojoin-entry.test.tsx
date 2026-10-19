import React from 'react';
import { Text } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import CoinjoinEntry from '../../screen/settings/CoinjoinExperimental';
const mockLive = jest.fn(({ experimentalAcknowledged }: { experimentalAcknowledged: boolean }) => (
  <Text>{experimentalAcknowledged ? 'Live explicitly acknowledged' : 'Missing acknowledgment'}</Text>
));
jest.mock('../../screen/settings/CoinjoinLive', () => (props: { experimentalAcknowledged: boolean }) => mockLive(props));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
afterEach(() => {
  cleanup();
  mockLive.mockClear();
});
test('entering the main-app tool does not start live participation before explicit opt-in', () => {
  const screen = render(<CoinjoinEntry />);
  expect(screen.getByText('Experimental · Testing')).toBeTruthy();
  expect(mockLive).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('CoinjoinOptIn'));
  expect(screen.getByText('Live explicitly acknowledged')).toBeTruthy();
});
test('sample mode remains offline and never mounts the live participant', () => {
  const screen = render(<CoinjoinEntry />);
  fireEvent.press(screen.getByTestId('CoinjoinSample'));
  expect(screen.getByTestId('CoinjoinOfflineNotice')).toBeTruthy();
  fireEvent.press(screen.getByTestId('CoinjoinReviewSample'));
  expect(screen.getByTestId('CoinjoinSignDisabled')).toBeDisabled();
  expect(mockLive).not.toHaveBeenCalled();
});
