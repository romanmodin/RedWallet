import { renderHook, act } from '@testing-library/react-native';
import { useSecretExport } from '../../hooks/useSecretExport';
const mockStorage = {
  cachedPassword: undefined as string | undefined,
  isPasswordInUse: jest.fn(),
};
const mockPrompt = jest.fn();
const mockUnlock = jest.fn();
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => mockStorage,
}));
jest.mock('../../helpers/prompt', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockPrompt(...args),
}));
jest.mock('../../hooks/useBiometrics', () => ({
  unlockWithBiometrics: () => mockUnlock(),
}));
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.cachedPassword = undefined;
});
it('requires device authentication even when no storage password is configured', async () => {
  mockUnlock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { result } = renderHook(useSecretExport);
  await act(async () => {
    expect(await result.current()).toBe(false);
  });
  await act(async () => {
    expect(await result.current()).toBe(true);
  });
  expect(mockUnlock).toHaveBeenCalledTimes(2);
});
it('does not accept a decoy bucket password for the active wallet', async () => {
  mockStorage.cachedPassword = 'active password';
  mockPrompt.mockResolvedValue('decoy password');
  mockStorage.isPasswordInUse.mockResolvedValue(true);
  const { result } = renderHook(useSecretExport);
  await act(async () => {
    expect(await result.current()).toBe(false);
  });
  expect(mockStorage.isPasswordInUse).not.toHaveBeenCalled();
});
it('requires the active password and denies cancellation', async () => {
  mockStorage.cachedPassword = 'active password';
  mockPrompt.mockRejectedValueOnce(new Error('canceled')).mockResolvedValueOnce('active password');
  mockStorage.isPasswordInUse.mockResolvedValue(true);
  const { result } = renderHook(useSecretExport);
  await act(async () => {
    expect(await result.current()).toBe(false);
  });
  await act(async () => {
    expect(await result.current()).toBe(true);
  });
  expect(mockUnlock).not.toHaveBeenCalled();
});
