import { StandardHardwareNativeFixture, PUBLIC_WATCH_ACCOUNT, PUBLIC_RECEIVE_ADDRESS } from './standard-hardware-fixture';

// This import previously crashed only under Detox's separate Jest config.
// Keep this preflight ahead of the expensive simulator build and node setup.
test('native host loads real signing crypto and derives the public BIP84 account', () => {
  expect(PUBLIC_WATCH_ACCOUNT).toMatch(/^\[73c5da0a\/84h\/0h\/0h\]xpub/);
  expect(PUBLIC_RECEIVE_ADDRESS).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  expect(new StandardHardwareNativeFixture().proof).toBe('missing');
});
