import { dismissAlertByText, getSwitchValue, waitForId, waitForWalletsList, waitForText } from './helperz';
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const assert = require('assert').strict;
const { cleanupTlsFixture } = require('./tls-fixture-cleanup');
const { prepareTlsApp } = require('./tls-setup');
const { observeNativeSetupStep } = require('./native-setup-step');
const { execFileSync } = require('child_process');
const scenarios = require('./tls-scenarios.json');
const selectedCase = process.env.REDWALLET_TLS_CASE;
if (selectedCase && !scenarios.some(scenario => scenario.id === selectedCase)) {
  throw new Error('Unknown TLS scenario: ' + selectedCase);
}
const selectedScenarios = selectedCase ? scenarios.filter(scenario => scenario.id === selectedCase) : scenarios;

// Disposable local certificates and a public header; no seeds, funds, or external backend.
const fixture = name => fs.readFileSync(path.join(__dirname, '../fixtures/tls', name));
const checkpoint = fs.readFileSync(path.join(__dirname, '../../class/xbt/electrum-checkpoint.ts'), 'utf8').match(/'([0-9a-f]{328})'/)[1];
const failed =
  'Cannot connect to the provided Electrum server. TLS requires a trusted certificate matching the server name. XBT servers must also match the mainnet checkpoint.';
const saved = 'Your changes have been saved successfully. Restarting RedWallet may be required for the changes to take effect.';

function field(id) {
  // The iOS native hierarchy exposes this custom AddressInput's placeholder
  // value but omits its testID. Match the actual, unique native input instead.
  return device.getPlatform() === 'ios' && id === 'HostInput'
    ? element(by.type('RCTUITextField').and(by.value('E.g., 10.20.30.40')))
    : element(by.id(id));
}

async function visible(id) {
  // Offline mode and SSL reveal fields after React state/async preference
  // updates. With iOS synchronization disabled, wait for the field to mount
  // before scrolling; an empty form cannot scroll while that update is pending.
  if (device.getPlatform() === 'ios') {
    // Poll from the runner between checks while synchronization is disabled.
    // Preserve native identifiers in the failure diagnostic below.
    const deadline = Date.now() + 30_000;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
        await expect(field(id)).toExist();
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
    }
  } else {
    await waitFor(field(id)).toExist().withTimeout(30_000);
  }
  await waitFor(field(id))
    .toBeVisible()
    .whileElement(by.id('ElectrumSettingsScrollView'))
    // Start in the outer margin so the multiline PEM editor cannot consume the gesture.
    .scroll(150, 'down', 0.95, 0.5);
}

async function openSettings() {
  await waitForWalletsList();
  await element(by.id('SettingsButton')).tap();
  await waitForId('SettingsRoot');
  await waitFor(element(by.id('NetworkSettings')))
    .toBeVisible()
    .whileElement(by.id('SettingsRoot'))
    .scroll(150, 'down');
  await element(by.id('NetworkSettings')).tap();
  await waitForId('ElectrumSettings');
  await element(by.id('ElectrumSettings')).tap();
  await waitForId('ElectrumConnectionEnabledSwitch');
  if (await getSwitchValue('ElectrumConnectionEnabledSwitch')) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
}

describe('native Electrum TLS authentication', () => {
  for (const scenario of selectedScenarios) {
    it(scenario.name, async () => {
      let requests = 0;
      let beforeRestart = null;
      let resetReceipt = null;
      const directory = path.join(process.cwd(), 'artifacts/tls/diagnostics', scenario.id);
      fs.mkdirSync(directory, { recursive: true });
      const setupEntries = [];
      const setup = (name, action, timeoutMs) =>
        observeNativeSetupStep(
          name,
          action,
          entry => {
            setupEntries.push(entry);
            fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setupEntries, null, 2) + '\n');
            console.log('[tls-e2e] setup:', scenario.id, JSON.stringify(entry));
          },
          timeoutMs,
        );
      const run = (command, args, options) => execFileSync(command, args, options).toString();
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
        resetReceipt = await prepareTlsApp({ device, setup, run });
        if (resetReceipt) fs.writeFileSync(path.join(directory, 'reset.json'), JSON.stringify(resetReceipt, null, 2) + '\n');
        console.log('[tls-e2e] app launched:', scenario.name);
        // Settings polling/reconnect timers must not hold every iOS action at idle.
        // Every connection outcome is still checked explicitly below.
        const isIOS = device.getPlatform() === 'ios';
        if (isIOS) await device.disableSynchronization();
        await openSettings();
        console.log('[tls-e2e] settings opened:', scenario.name);
        await visible('HostInput');
        await field('HostInput').replaceText(device.getPlatform() === 'android' ? '10.0.2.2' : '127.0.0.1');
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
        await waitForText(scenario.accepted ? saved : failed, 60_000);
        console.log('[tls-e2e] expected connection result:', scenario.name, 'RPCs:', requests);
        assert.equal(await dismissAlertByText('OK', 10_000, false), true, 'Could not dismiss the connection result');
        if (scenario.accepted) {
          assert.ok(requests >= 3, 'Trusted TLS must allow the Electrum handshake and checkpoint requests');
          beforeRestart = requests;
          await device.launchApp({ newInstance: true });
          if (isIOS) await device.disableSynchronization();
          await waitForWalletsList();
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
      } catch (error) {
        // The automatic failure screenshot runs after finally; preserve the
        // actual failed UI before cleanup terminates the app.
        console.error('[tls-e2e] failed:', scenario.name, 'RPCs:', requests, error.stack || error.message);
        if (device.getPlatform() === 'ios') {
          // Do not depend on an app process or Detox's stalled launch to capture
          // SpringBoard failures. This command is bounded and never resets it.
          try {
            execFileSync('xcrun', ['simctl', 'io', device.id, 'screenshot', path.join(directory, 'failure.png')], {
              timeout: 15000,
              stdio: 'pipe',
            });
          } catch (_) {}
        } else {
          await setup('failure-screenshot', () => device.takeScreenshot('tls-failure-before-cleanup'), 15000).catch(() => {});
        }
        await setup('failure-hierarchy', () => device.generateViewHierarchyXml(false), 15000)
          .then(xml => fs.writeFileSync(path.join(directory, 'failure.xml'), xml))
          .catch(() => {});
        throw error;
      } finally {
        await cleanupTlsFixture(device, server, sockets);
      }
      // Only write success after every native assertion AND fixture cleanup.
      fs.writeFileSync(
        path.join(directory, 'result.json'),
        JSON.stringify(
          {
            scenario: scenario.id,
            name: scenario.name,
            sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
              encoding: 'utf8',
              timeout: 5000,
            }).trim(),
            accepted: !!scenario.accepted,
            rpcRequests: requests,
            beforeRestart,
            savedTrustVerified: scenario.accepted ? requests > beforeRestart : null,
            rejectedBeforeRpc: scenario.accepted ? null : requests === 0,
            cleanupComplete: true,
            passed: true,
          },
          null,
          2,
        ) + '\n',
      );
    });
  }
});
