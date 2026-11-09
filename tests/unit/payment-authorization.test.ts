import { renderHook } from '@testing-library/react-native';
import { usePaymentAuthorization } from '../../hooks/usePaymentAuthorization';
const mockRead = jest.fn();
const mockUnlock = jest.fn();
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => ({ getItem: mockRead }),
}));
jest.mock('../../hooks/useBiometrics', () => ({
  unlockWithBiometrics: () => mockUnlock(),
}));
beforeEach(() => {
  jest.clearAllMocks();
});
test('disabled authentication does not prompt', async () => {
  mockRead.mockResolvedValue(null);
  const { result } = renderHook(usePaymentAuthorization);
  expect(await result.current()).toBe(true);
  expect(mockRead).toHaveBeenCalledWith('Biometrics');
  expect(mockUnlock).not.toHaveBeenCalled();
});
test.each([true, false])('enabled authentication requires actual success=%s', async allowed => {
  mockRead.mockResolvedValue('1');
  mockUnlock.mockResolvedValue(allowed);
  const { result } = renderHook(usePaymentAuthorization);
  expect(await result.current()).toBe(allowed);
  expect(mockUnlock).toHaveBeenCalledTimes(1);
});
test('a policy read failure never disables authentication', async () => {
  mockRead.mockRejectedValue(new Error('Secure storage unavailable'));
  const { result } = renderHook(usePaymentAuthorization);
  await expect(result.current()).rejects.toThrow('Secure storage unavailable');
  expect(mockUnlock).not.toHaveBeenCalled();
});
test('the policy is read again for each submission', async () => {
  mockRead.mockResolvedValueOnce(null).mockResolvedValueOnce('1');
  mockUnlock.mockResolvedValue(false);
  const { result } = renderHook(usePaymentAuthorization);
  expect(await result.current()).toBe(true);
  expect(await result.current()).toBe(false);
});
