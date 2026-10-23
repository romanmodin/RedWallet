import AsyncStorage from '@react-native-async-storage/async-storage';
import Keychain from 'react-native-keychain';
import { runKilojoinNativeSelfTest } from '../../class/xbt/kilojoin/native-self-test';
jest.mock('../../class/xbt/kilojoin/wallet-adapter', () => ({
  nativeEntropy: (length: number) => require('crypto').randomBytes(length),
}));
jest.mock('react-native-keychain', () => {
  const keys = new Map<string, string>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
    SECURITY_LEVEL: { SECURE_HARDWARE: 'hardware' },
    resetGenericPassword: jest.fn(async (options: { service: string }) => keys.delete(options.service)),
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

test('offline native self-test exercises five blind outputs, actual startup envelopes in both orders, and authenticated storage', async () => {
  await AsyncStorage.setItem('unrelated-wallet-record', 'preserve');
  await runKilojoinNativeSelfTest();
  expect(await AsyncStorage.getItem('unrelated-wallet-record')).toBe('preserve');
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(5);
  const services = (Keychain.resetGenericPassword as jest.Mock).mock.calls.map(([options]) => options.service);
  expect(new Set(services).size).toBe(5);
  for (const service of services) expect(await AsyncStorage.getItem(service)).toBeNull();
});
