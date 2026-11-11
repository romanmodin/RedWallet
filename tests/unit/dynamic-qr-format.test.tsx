import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { DynamicQRCode } from '../../components/DynamicQRCode';

jest.mock('../../blue_modules/ur', () => ({
  encodeUR: (_value: string, _capacity: number, _wallet: string, protocol: string) =>
    protocol === 'BBQR' ? ['b$only'] : ['ur:first', 'ur:second', 'ur:third'],
}));
jest.mock('../../components/QRCode', () => ({ __esModule: true, default: ({ value }: { value: string }) => <Text>{value}</Text> }));
jest.mock('../../components/themes', () => ({ BlueCurrentTheme: { colors: { foregroundColor: 'white' } } }));
jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    formatString: (_text: string, args: { number: number; total: number }) => `${args.number}/${args.total}`,
    _: { of: '' },
    send: { dynamic_prev: 'Previous', dynamic_next: 'Next', dynamic_stop: 'Stop', dynamic_start: 'Start' },
  },
}));

test('switching from a later UR frame to shorter BBQr resets the frame and remains usable', () => {
  jest.useFakeTimers();
  const clear = jest.spyOn(global, 'clearInterval');
  const view = render(<DynamicQRCode value="70736274ff" hideControls={false} />);
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(view.getByText('UR:THIRD')).toBeTruthy();
  fireEvent.press(view.getByText('BBQr format'));
  expect(view.getByText('B$ONLY')).toBeTruthy();
  expect(view.getByText('1/1')).toBeTruthy();
  fireEvent.press(view.getByText('UR v2 format'));
  expect(view.getByText('UR:FIRST')).toBeTruthy();
  view.unmount();
  expect(clear).toHaveBeenCalled();
  clear.mockRestore();
  jest.useRealTimers();
});
