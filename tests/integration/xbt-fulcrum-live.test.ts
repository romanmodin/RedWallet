import { testConnection } from '../../blue_modules/BlueElectrum';

const host = process.env.XBT_FULCRUM_HOST;
const tcpPort = Number(process.env.XBT_FULCRUM_TCP_PORT);
const liveTest = host && Number.isInteger(tcpPort) && tcpPort > 0 ? it : it.skip;

jest.setTimeout(30_000);

describe('XBT Fulcrum live integration', () => {
  liveTest('connects only when the Electrum server reports the pinned XBT checkpoint', async () => {
    expect(await testConnection(host!, tcpPort)).toBe(true);
  });
});
