import AsyncStorage from '@react-native-async-storage/async-storage';
import Keychain from 'react-native-keychain';
import { SessionVault } from '../../class/xbt/kilojoin/vault';
import { SessionState } from '../../class/xbt/kilojoin/session';
jest.mock('../../class/xbt/kilojoin/wallet-adapter', () => ({ nativeEntropy: (length: number) => require('crypto').randomBytes(length) }));
jest.mock('react-native-keychain', () => {
  const keys = new Map<string, string>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
    SECURITY_LEVEL: { SECURE_HARDWARE: 'hardware' },
    getSecurityLevel: jest.fn(async () => 'hardware'),
    getGenericPassword: jest.fn(async (options: { service: string }) =>
      keys.has(options.service) ? { password: keys.get(options.service) } : false,
    ),
    setGenericPassword: jest.fn(async (_user: string, password: string, options: { service: string }) => {
      keys.set(options.service, password);
      return true;
    }),
  };
});
const state: SessionState = {
  phase: 'open',
  sequence: 1,
  seats: [],
  signatures: {},
  deadline: 10000,
  token: 'membership-secret',
  poolSecret: 'ab'.repeat(32),
};
afterEach(() => jest.clearAllMocks());
test('session secrets are encrypted, survive reopening and use device-only key storage', async () => {
  const vault = new SessionVault('wallet-one', 'ab'.repeat(8));
  await vault.save(state);
  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls;
  const encoded = writes[writes.length - 1][1];
  expect(encoded).not.toContain('membership-secret');
  expect(encoded).not.toContain(state.poolSecret);
  expect(await new SessionVault('wallet-one', 'ab'.repeat(8)).load()).toEqual(state);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({ accessible: 'device-only', securityLevel: 'hardware' }),
  );
});
test('tampered encrypted session is rejected', async () => {
  const vault = new SessionVault('wallet-two', 'ab'.repeat(8));
  await vault.save(state);
  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls,
    [service, encoded] = writes[writes.length - 1];
  const envelope = JSON.parse(encoded);
  envelope.ciphertext = (envelope.ciphertext[0] === '0' ? '1' : '0') + envelope.ciphertext.slice(1);
  await AsyncStorage.setItem(service, JSON.stringify(envelope));
  await expect(vault.load()).rejects.toThrow();
});
test('missing key cannot silently replace an existing session encryption key', async () => {
  const vault = new SessionVault('wallet-three', 'ab'.repeat(8));
  await vault.save(state);
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce(false);
  await expect(vault.save(state)).rejects.toThrow('key missing');
});
test('native key persistence failure prevents writing session ciphertext', async () => {
  const vault = new SessionVault('wallet-four', 'ab'.repeat(8));
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValueOnce(false);
  await expect(vault.save(state)).rejects.toThrow('encryption key');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('same-pool attempts have isolated vaults so late old writes cannot overwrite a new session', async () => {
  const old = new SessionVault('retry-wallet', 'ab'.repeat(8), '11'.repeat(32));
  const next = new SessionVault('retry-wallet', 'ab'.repeat(8), '22'.repeat(32));
  await old.save(state);
  await next.save({ ...state, sequence: 7 });
  await old.save({ ...state, sequence: 2 });
  expect(await next.load()).toEqual({ ...state, sequence: 7 });
  expect(await old.load()).toEqual({ ...state, sequence: 2 });
});
