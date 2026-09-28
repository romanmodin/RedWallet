import { readFileSync } from 'fs';
import DefaultPreference from 'react-native-default-preference';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { GROUP_IO_BLUEWALLET } from '../../blue_modules/currency';
import { XBT_MAINNET_CHECKPOINT_HEIGHT } from '../../class/xbt/electrum-checkpoint';

const host = process.env.XBT_FULCRUM_HOST;
const tcpPort = Number(process.env.XBT_FULCRUM_TCP_PORT);
const configured = host && Number.isInteger(tcpPort) && tcpPort > 0 && tcpPort <= 65535;
const liveTest = configured ? it : it.skip;
const fixturePath = process.env.XBT_FULCRUM_FIXTURE;
const backendTest = configured && fixturePath ? it : it.skip;

jest.setTimeout(30_000);

describe('XBT Fulcrum live integration', () => {
  afterEach(() => BlueElectrum.forceDisconnect());

  liveTest('connects only when the Electrum server reports the pinned XBT checkpoint', async () => {
    expect(await BlueElectrum.testConnection(host!, tcpPort)).toBe(true);
  });

  backendTest('reads a Knots-verified public output, history, balance, tip, and fee estimates through the app adapter', async () => {
    // Supply a fresh public, unspent output independently checked with Knots gettxout.
    // This test never loads a wallet, signs, broadcasts, or changes server configuration.
    const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8'));
    expect(fixture.chain).toBe('main');
    expect(Number.isSafeInteger(fixture.height)).toBe(true);
    expect(fixture.height).toBeGreaterThanOrEqual(XBT_MAINNET_CHECKPOINT_HEIGHT);
    expect(fixture.txid).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.address).toMatch(/^bc1q[a-z0-9]{38}$/);
    expect(Number.isSafeInteger(fixture.vout)).toBe(true);
    expect(fixture.vout).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(fixture.valueSats)).toBe(true);
    expect(fixture.valueSats).toBeGreaterThan(0);

    // DefaultPreference is the existing in-memory Jest mock; the socket is real.
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(BlueElectrum.ELECTRUM_HOST, host!);
    await DefaultPreference.set(BlueElectrum.ELECTRUM_TCP_PORT, String(tcpPort));
    await DefaultPreference.clear(BlueElectrum.ELECTRUM_SSL_PORT);
    await BlueElectrum.setDisabled(false);
    expect(await BlueElectrum.ensureConnected()).toBe(true);

    const address: string = fixture.address;
    const [history, utxos, balance, tip, fees] = await Promise.all([
      BlueElectrum.multiGetHistoryByAddress([address]),
      BlueElectrum.multiGetUtxoByAddress([address]),
      BlueElectrum.multiGetBalanceByAddress([address]),
      BlueElectrum.getCurrentBlockTip(),
      BlueElectrum.estimateFees(),
    ]);
    expect(history[address]).toEqual(expect.arrayContaining([expect.objectContaining({ tx_hash: fixture.txid, height: fixture.height })]));
    expect(utxos[address]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ txid: fixture.txid, vout: fixture.vout, value: fixture.valueSats, height: fixture.height, address }),
      ]),
    );
    expect(Number.isSafeInteger(balance.addresses[address].confirmed)).toBe(true);
    expect(Number.isSafeInteger(balance.addresses[address].unconfirmed)).toBe(true);
    expect(tip).toBeGreaterThanOrEqual(fixture.height);
    for (const fee of Object.values(fees)) {
      expect(Number.isSafeInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThan(0);
    }
    console.info('XBT live backend receipt', {
      height: fixture.height,
      tip,
      historyEntries: history[address].length,
      utxos: utxos[address].length,
      fees,
    });
  });
});
