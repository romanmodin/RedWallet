import { dismissAlertByText, getSwitchValue, waitForId, waitForText } from './helperz';
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const assert = require('assert').strict;

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
    // Start in the outer margin so the multiline PEM editor cannot consume the gesture.
    .scroll(150, 'down', 0.95, 0.5);
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
    { name: 'configured private CA and matching name', cert: 'native.pem', anchor: 'ca.pem', accepted: true },
    { name: 'configured server certificate and matching name', cert: 'replacement.pem', anchor: 'replacement.pem', accepted: true },
    { name: 'expired explicitly trusted server certificate', cert: 'native-expired.pem', anchor: 'native-expired.pem' },
    { name: 'untrusted certificate', cert: 'native.pem' },
    { name: 'trusted certificate with wrong name', cert: 'server.pem', anchor: 'ca.pem' },
    { name: 'expired certificate', cert: 'native-expired.pem', anchor: 'ca.pem' },
    { name: 'replaced certificate', cert: 'replacement.pem', anchor: 'ca.pem' },
  ]) {
    it(scenario.name, async () => {
      let requests = 0;
      const sockets = new Set();
      const server = tls.createServer({ key: fixture('server.key'), cert: fixture(scenario.cert) }, socket => {
        // A deliberate app restart can reset a disposable test connection.
        socket.on('error', () => {});
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
        // Settings polling/reconnect timers must not hold every iOS action at idle.
        // Every connection outcome is still checked explicitly below.
        const isIOS = device.getPlatform() === 'ios';
        if (isIOS) await device.disableSynchronization();
        await openSettings();
        console.log('[tls-e2e] settings opened:', scenario.name);
        await visible('HostInput');
        await element(by.id('HostInput')).replaceText(device.getPlatform() === 'android' ? '10.0.2.2' : '127.0.0.1');
        await visible('PortInput');
        await element(by.id('PortInput')).replaceText(String(server.address().port));
        await visible('SSLPortInput');
        if (!(await getSwitchValue('SSLPortInput'))) await element(by.id('SSLPortInput')).tap();
        await visible('TlsCaInput');
        await element(by.id('TlsCaInput')).replaceText(scenario.anchor ? fixture(scenario.anchor).toString().trim() : '');
        await element(by.id('TlsCaInput')).tapReturnKey();
        console.log('[tls-e2e] certificate entered:', scenario.name);
        await element(by.id('ElectrumSettingsScrollView')).scrollTo('bottom', 0.95, 0.5);
        await waitFor(element(by.id('Save')))
          .toBeVisible()
          .withTimeout(15_000);
        console.log('[tls-e2e] saving server:', scenario.name);
        await element(by.id('Save')).tap();
        await waitForText(scenario.accepted ? saved : failed, 30_000);
        console.log('[tls-e2e] expected connection result:', scenario.name, 'RPCs:', requests);
        assert.equal(await dismissAlertByText('OK', 10_000, false), true, 'Could not dismiss the connection result');
        if (scenario.accepted) {
          assert.ok(requests >= 3, 'Trusted TLS must allow the Electrum handshake and checkpoint requests');
          const beforeRestart = requests;
          await device.launchApp({ newInstance: true });
          if (isIOS) await device.disableSynchronization();
          await waitForId('WalletsList', 120_000);
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            if (requests > beforeRestart) break;
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          // The saved certificate must also reach the normal connection path.
          console.log('[tls-e2e] normal connection after restart:', scenario.name, 'RPCs:', requests);
          assert.ok(requests > beforeRestart, 'Saved trust must authenticate the normal connection after restart');
        } else {
          // Even an impostor serving the correct public fork header gets no RPCs.
          assert.equal(requests, 0, 'Rejected TLS must never receive Electrum requests');
        }
      } finally {
        if (device.getPlatform() === 'ios') await device.enableSynchronization();
        await device.terminateApp();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    });
  }
});
