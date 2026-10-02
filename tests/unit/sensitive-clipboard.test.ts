import Clipboard from '@react-native-clipboard/clipboard';
import { AppState } from 'react-native';
import { copySensitiveClipboard, clearSensitiveClipboard, SECRET_CLIPBOARD_TTL_MS } from '../../blue_modules/sensitive-clipboard';

let content = '';
let onState: (state: any) => void;
beforeEach(() => {
  AppState.currentState = 'active';
  jest.useFakeTimers();
  jest.spyOn(Clipboard, 'setString').mockImplementation(value => {
    content = value;
  });
  jest.spyOn(Clipboard, 'getString').mockImplementation(async () => content);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onState = callback;
    return { remove: jest.fn() };
  });
});
afterEach(async () => {
  await clearSensitiveClipboard();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('expires copied secrets after 30 seconds', async () => {
  copySensitiveClipboard('test seed');
  expect(content).toBe('test seed');
  await jest.advanceTimersByTimeAsync(SECRET_CLIPBOARD_TTL_MS);
  expect(content).toBe('');
});
it('clears a secret when the app leaves the foreground', async () => {
  copySensitiveClipboard('test key');
  onState('background');
  await Promise.resolve();
  expect(content).toBe('');
});
it('preserves text copied after a secret', async () => {
  copySensitiveClipboard('test seed');
  content = 'recipient address';
  await clearSensitiveClipboard();
  expect(content).toBe('recipient address');
});
it('does not let an old clear operation remove a newly copied secret', async () => {
  copySensitiveClipboard('old seed');
  let resolveClipboard!: (value: string) => void;
  jest.spyOn(Clipboard, 'getString').mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveClipboard = resolve;
      }),
  );
  const clearing = clearSensitiveClipboard();
  copySensitiveClipboard('new seed');
  resolveClipboard('old seed');
  await clearing;
  expect(content).toBe('new seed');
  await jest.advanceTimersByTimeAsync(SECRET_CLIPBOARD_TTL_MS);
  expect(content).toBe('');
});
