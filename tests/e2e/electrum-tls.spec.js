import { dismissAlertByText, getSwitchValue, waitForId, waitForText } from './helperz';
const fs = require('fs');
const path = require('path');
const tls = require('tls');

// Disposable local certificates and a public header; no seeds, funds, or external backend.
const fixture = name => fs.readFileSync(path.join(__dirname, '../fixtures/tls', name));
const checkpoint = fs.readFileSync(path.join(__dirname, '../../class/xbt/electrum-checkpoint.ts'), 'utf8').match(/'([0-9a-f]{328})'/)[1];
const failed =
  'Cannot connect to the provided Electrum server. TLS requires a trusted certificate matching the server name. XBT servers must also match the mainnet checkpoint.';
const saved = 'Your changes have been saved successfully. Restarting RedWallet may be required for the changes to take effect.';

async function visible(id) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .whileElement(by.id('ElectrumSettingsScrollView'))
    .scroll(150, 'down');
}

async function openSettings() {
  await waitForId('WalletsList', 120_000);
  await element(by.id('SettingsButton')).tap();
  await element(by.id('NetworkSettings')).tap();
  await element(by.id('ElectrumSettings')).tap();
  await waitForId('ElectrumConnectionEnabledSwitch');
  if (await getSwitchValue('ElectrumConnectionEnabledSwitch')) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
}

describe('native Electrum TLS authentication', () => {
  for (const scenario of [
    { name: 'configured private CA and matching name', cert: 'native.pem', trusted: true, accepted: true },
    { name: 'untrusted certificate', cert: 'native.pem', trusted: false },
    { name: 'trusted certificate with wrong name', cert: 'server.pem', trusted: true },
    { name: 'expired certificate', cert: 'native-expired.pem', trusted: true },
    { name: 'replaced certificate', cert: 'replacement.pem', trusted: true },
  ]) {
    it(scenario.name, async () => {
      let requests = 0;
      const sockets = new Set();
      const server = tls.createServer({ key: fixture('server.key'), cert: fixture(scenario.cert) }, socket => {
        let buffer = '';
        socket.on('data', data => {
          buffer += data.toString();
          while (buffer.includes('\n')) {
            const offset = buffer.indexOf('\n');
            const request = JSON.parse(buffer.slice(0, offset));
            buffer = buffer.slice(offset + 1);
            requests++;
            const result =
              request.method === 'blockchain.block.header'
                ? checkpoint
                : request.method === 'server.version'
                  ? ['RedWallet local test', '1.4']
                  : request.method === 'blockchain.headers.subscribe'
                    ? { height: 961640, hex: checkpoint }
                    : true;
            socket.write(JSON.stringify({ id: request.id, result }) + '\n');
          }
        });
      });
      server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      server.on('tlsClientError', () => {});
      await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
      try {
        await device.clearKeychain();
        await device.launchApp({ delete: true, permissions: { notifications: 'NO' } });
        await openSettings();
        await visible('HostInput');
        await element(by.id('HostInput')).replaceText(device.getPlatform() === 'android' ? '10.0.2.2' : '127.0.0.1');
        await element(by.id('PortInput')).replaceText(String(server.address().port));
        if (!(await getSwitchValue('SSLPortInput'))) await element(by.id('SSLPortInput')).tap();
        if (scenario.trusted) {
          await visible('TlsCaInput');
          await element(by.id('TlsCaInput')).replaceText(fixture('ca.pem').toString().trim());
          await element(by.id('TlsCaInput')).tapReturnKey();
        }
        await visible('Save');
        await element(by.id('Save')).tap();
        await waitForText(scenario.accepted ? saved : failed, 30_000);
        expect(await dismissAlertByText('OK')).toBe(true);
        if (scenario.accepted) {
          expect(requests).toBeGreaterThanOrEqual(3);
          const beforeRestart = requests;
          await device.launchApp({ newInstance: true });
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            if (requests > beforeRestart) break;
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          // The saved certificate must also reach the normal connection path.
          expect(requests).toBeGreaterThan(beforeRestart);
        } else {
          // Even an impostor serving the correct public fork header gets no RPCs.
          expect(requests).toBe(0);
        }
      } finally {
        await device.terminateApp();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    });
  }
});
