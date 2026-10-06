import * as bitcoin from 'bitcoinjs-lib';
import { Platform } from 'react-native';
import CPFP from '../../screen/transactions/CPFP';
import RBFBumpFee from '../../screen/transactions/RBFBumpFee';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import confirm from '../../helpers/confirm';
import { unlockWithBiometrics } from '../../hooks/useBiometrics';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  ensureConnected: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../helpers/confirm', () => jest.fn());
jest.mock('../../hooks/useBiometrics', () => ({
  unlockWithBiometrics: jest.fn(),
}));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: { NotificationError: 'error' },
}));
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
  AlertType: { Toast: 'toast' },
}));

function reviewScreen(fee = 20_000, recipient = 0, initializeReview = true, Screen: typeof CPFP | typeof RBFBumpFee = CPFP) {
  const wallet = new XbtTaprootWallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const transaction = new bitcoin.Transaction();
  transaction.addInput(Buffer.alloc(32, 1), 0);
  transaction.setWitness(0, [Buffer.alloc(65)]);
  transaction.addOutput(bitcoin.address.toOutputScript(wallet._getInternalAddressByIndex(0)), 50_000n);
  if (recipient) transaction.addOutput(bitcoin.address.toOutputScript(wallet._getExternalAddressByIndex(0)), BigInt(recipient));
  const screen = new Screen({
    route: { params: { wallet, txid: transaction.getId() } },
    navigation: {},
  });
  const storage = { getItem: jest.fn().mockResolvedValue('') };
  screen.context = storage;
  // Exercise the class's asynchronous broadcast callback without mounting a native renderer.
  screen.setState = ((update: any, callback?: () => void) => {
    Object.assign(screen.state, update);
    callback?.();
  }) as typeof screen.setState;
  screen.onSuccessBroadcast = jest.fn();
  const broadcast = jest.spyOn(wallet, 'broadcastTx').mockResolvedValue(true);
  if (initializeReview) screen.reviewFeeBump({ tx: transaction, fee });
  Object.assign(screen.state, { txhex: transaction.toHex() });
  const reviewState = screen.state as typeof screen.state & {
    feeSats?: number;
    actualFeeRate?: number;
    txhex?: string;
  };
  return { screen, broadcast, transaction, storage, reviewState };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => jest.clearAllMocks());

it('does not contact the network or broadcast when the high-fee review is declined', async () => {
  const { screen, broadcast } = reviewScreen();
  (confirm as jest.Mock).mockResolvedValue(false);
  screen.broadcast();
  await flush();
  expect(confirm).toHaveBeenCalledWith('High transaction fee', expect.stringContaining('20000 sats'));
  expect(BlueElectrum.ensureConnected).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});

it('broadcasts only the reviewed fee bump after explicit high-fee acceptance', async () => {
  const { screen, broadcast, transaction } = reviewScreen();
  (confirm as jest.Mock).mockResolvedValue(true);
  screen.broadcast();
  await flush();
  expect(broadcast).toHaveBeenCalledWith(transaction.toHex());
  expect(screen.onSuccessBroadcast).toHaveBeenCalledTimes(1);
});

it('rejects a changed transaction after fee review', async () => {
  const { screen, broadcast } = reviewScreen();
  Object.assign(screen.state, { txhex: '00' });
  screen.broadcast();
  await flush();
  expect(confirm).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});

it('keeps enabled biometrics as a broadcast gate', async () => {
  const { screen, broadcast } = reviewScreen();
  (screen.context as { getItem: jest.Mock }).getItem.mockResolvedValue('1');
  (unlockWithBiometrics as jest.Mock).mockResolvedValue(false);
  screen.broadcast();
  await flush();
  expect(unlockWithBiometrics).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});

it('compares a high fee to recipient amounts without diluting the warning with change', async () => {
  const { screen, broadcast } = reviewScreen(200, 1_000);
  (confirm as jest.Mock).mockResolvedValue(false);
  screen.broadcast();
  await flush();
  expect(confirm).toHaveBeenCalledWith('High transaction fee', expect.stringContaining('200 sats'));
  expect(broadcast).not.toHaveBeenCalled();
});

it.each([
  ['CPFP', CPFP, 'createCPFPbumpFee'],
  ['RBF', RBFBumpFee, 'createRBFbumpFee'],
])('creates a reviewed hot-wallet %s fee bump through the screen action before broadcasting', async (_label, Screen, method) => {
  const { screen, broadcast, transaction, reviewState } = reviewScreen(500, 0, false, Screen);
  const create = jest.fn().mockResolvedValue({ tx: transaction, fee: 500 });
  Object.assign(screen.state, {
    newFeeRate: '10',
    feeRate: 1,
    tx: { [method]: create },
    txhex: undefined,
  });
  await screen.createTransaction();
  expect(create).toHaveBeenCalledWith(10);
  expect(screen.state.stage).toBe(2);
  expect(reviewState.feeSats).toBe(500);
  expect(reviewState.actualFeeRate).toBe(500 / transaction.virtualSize());
  screen.broadcast();
  await flush();
  expect(broadcast).toHaveBeenCalledWith(transaction.toHex());
  expect(screen.onSuccessBroadcast).toHaveBeenCalledTimes(1);
});

it.each([
  ['CPFP', CPFP, 'createCPFPbumpFee'],
  ['RBF', RBFBumpFee, 'createRBFbumpFee'],
])('keeps an invalid %s fee result out of the broadcast stage', async (_label, Screen, method) => {
  const { screen, broadcast, transaction, reviewState } = reviewScreen(500, 0, false, Screen);
  Object.assign(screen.state, {
    newFeeRate: '10',
    feeRate: 1,
    txhex: undefined,
    tx: {
      [method]: jest.fn().mockResolvedValue({ tx: transaction, fee: Number.NaN }),
    },
  });
  await screen.createTransaction();
  expect(screen.state.stage).toBe(1);
  expect(reviewState.txhex).toBeUndefined();
  expect(broadcast).not.toHaveBeenCalled();
});

const originalPlatform = Platform.OS;
afterEach(() => {
  Platform.OS = originalPlatform;
});

it.each([
  ['android', '{"code":404,"api-level":35,"message":Biometrics has not been set}'],
  ['ios', '{"message":"key does not present"}'],
] as const)('permits a reviewed fee bump with an unset %s biometric preference', async (platform, message) => {
  Platform.OS = platform;
  const { screen, broadcast, transaction, storage } = reviewScreen(200, 90_000);
  storage.getItem.mockRejectedValue(Object.assign(new Error(message), { code: '404' }));
  screen.broadcast();
  await flush();
  expect(unlockWithBiometrics).not.toHaveBeenCalled();
  expect(broadcast).toHaveBeenCalledWith(transaction.toHex());
  expect(screen.onSuccessBroadcast).toHaveBeenCalledTimes(1);
});

it.each([
  ['1', 'Keystore cannot be unlocked'],
  ['404', 'An unrelated key has not been set'],
  ['404', 'Biometrics storage is corrupted'],
])('keeps storage failure %s/%s as a broadcast gate', async (code, message) => {
  Platform.OS = 'android';
  const { screen, broadcast, storage } = reviewScreen(200, 90_000);
  storage.getItem.mockRejectedValue(Object.assign(new Error(message), { code }));
  screen.broadcast();
  await flush();
  expect(BlueElectrum.ensureConnected).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
  expect(screen.state.isLoading).toBe(false);
});
