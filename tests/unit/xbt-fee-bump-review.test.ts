import * as bitcoin from 'bitcoinjs-lib';
import CPFP from '../../screen/transactions/CPFP';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import confirm from '../../helpers/confirm';
import { unlockWithBiometrics } from '../../hooks/useBiometrics';

jest.mock('../../blue_modules/BlueElectrum', () => ({ ensureConnected: jest.fn().mockResolvedValue(true) }));
jest.mock('../../helpers/confirm', () => jest.fn());
jest.mock('../../hooks/useBiometrics', () => ({ unlockWithBiometrics: jest.fn() }));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: { NotificationError: 'error' },
}));
jest.mock('../../components/Alert', () => ({ __esModule: true, default: jest.fn(), AlertType: { Toast: 'toast' } }));

function reviewScreen(fee = 20_000) {
  const wallet = new XbtTaprootWallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const transaction = new bitcoin.Transaction();
  transaction.addInput(Buffer.alloc(32, 1), 0);
  transaction.setWitness(0, [Buffer.alloc(65)]);
  transaction.addOutput(bitcoin.address.toOutputScript(wallet._getInternalAddressByIndex(0)), 50_000n);
  const screen = new CPFP({ route: { params: { wallet, txid: transaction.getId() } }, navigation: {} });
  const storage = { getItem: jest.fn().mockResolvedValue('') };
  screen.context = storage;
  // Exercise the class's asynchronous broadcast callback without mounting a native renderer.
  screen.setState = ((update: any, callback?: () => void) => {
    Object.assign(screen.state, update);
    callback?.();
  }) as typeof screen.setState;
  screen.onSuccessBroadcast = jest.fn();
  const broadcast = jest.spyOn(wallet, 'broadcastTx').mockResolvedValue(true);
  screen.reviewFeeBump({ tx: transaction, fee });
  Object.assign(screen.state, { txhex: transaction.toHex() });
  return { screen, broadcast, transaction, storage };
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
