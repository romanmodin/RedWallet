import * as bitcoin from 'bitcoinjs-lib';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { saveDocuments } from '@react-native-documents/picker';
import { writeFileAndExport } from '../../blue_modules/fs';

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  writeFile: jest.fn(),
  exists: jest.fn(async () => true),
  unlink: jest.fn(),
}));
jest.mock('react-native-share', () => ({ open: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({
  saveDocuments: jest.fn(async () => [{}]),
  errorCodes: { OPERATION_CANCELED: 'cancel' },
  types: { allFiles: '*/*' },
}));
jest.mock('react-native-image-picker', () => ({}));
jest.mock('react-native-camera-kit-no-google', () => ({}));
jest.mock('../../blue_modules/environment', () => ({ isDesktop: false }));
jest.mock('../../blue_modules/react-native-bw-file-access', () => ({}));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../loc', () => ({}));

beforeEach(() => jest.clearAllMocks());
test.each([false, true])('exports binary PSBT through save/share (%s) without changing transaction bytes', async share => {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: 'ab'.repeat(32), index: 1, witnessUtxo: { script: Buffer.from('0014' + '12'.repeat(20), 'hex'), value: 10000n } });
  psbt.addOutput({ script: Buffer.from('0014' + '34'.repeat(20), 'hex'), value: 9000n });
  await writeFileAndExport('unsigned.psbt', psbt.toBase64(), share, 'base64');
  const [path, content, encoding] = (RNFS.writeFile as jest.Mock).mock.calls[0];
  // Model RNFS encoding at the native filesystem boundary.
  const bytes = Buffer.from(content, encoding);
  expect(bytes.subarray(0, 5).toString('hex')).toBe('70736274ff');
  expect(bitcoin.Psbt.fromBuffer(bytes).toHex()).toBe(psbt.toHex());
  expect(share ? Share.open : saveDocuments).toHaveBeenCalledTimes(1);
  expect(RNFS.unlink).toHaveBeenCalledWith(path);
});
test('keeps existing text exports UTF-8', async () => {
  await writeFileAndExport('wallet.json', '{"label":"wallet"}', false);
  expect(RNFS.writeFile).toHaveBeenCalledWith(expect.any(String), '{"label":"wallet"}', 'utf8');
});
