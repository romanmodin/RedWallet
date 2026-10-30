/** @jest-environment node */
const net = require('net');
const { cleanupTlsFixture } = require('../e2e/tls-fixture-cleanup');

async function fixture() {
  const sockets = new Set();
  const server = net.createServer(socket => sockets.add(socket));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = net.connect(server.address().port, '127.0.0.1');
  await new Promise(resolve => client.once('connect', resolve));
  return { server, sockets, client };
}
function nativeDevice(server, failure, platform = 'ios') {
  const order = [];
  const device = { getPlatform: () => platform };
  for (const method of ['terminateApp', 'uninstallApp']) {
    device[method] = jest.fn(async () => {
      expect(server.listening).toBe(false);
      order.push(method);
      if (failure === method) throw new Error(method + ' failed');
    });
  }
  for (const method of ['clearKeychain', 'launchApp', 'enableSynchronization']) {
    device[method] = jest.fn(async () => {
      throw new Error('teardown must not reset or launch a new native process');
    });
  }
  return { device, order };
}

test('closes real TLS fixture sockets and removes the empty iOS app without another reset or launch', async () => {
  const { server, sockets, client } = await fixture();
  const { device, order } = nativeDevice(server);
  try {
    await cleanupTlsFixture(device, server, sockets);
    expect(server.listening).toBe(false);
    expect([...sockets].every(socket => socket.destroyed)).toBe(true);
    expect(order).toEqual(['terminateApp', 'uninstallApp']);
    expect(device.clearKeychain).not.toHaveBeenCalled();
    expect(device.launchApp).not.toHaveBeenCalled();
    expect(device.enableSynchronization).not.toHaveBeenCalled();
  } finally {
    client.destroy();
  }
});

test.each(['terminateApp', 'uninstallApp'])('%s failure still closes sockets and attempts uninstall once', async failure => {
  const { server, sockets, client } = await fixture();
  const { device, order } = nativeDevice(server, failure);
  try {
    await expect(cleanupTlsFixture(device, server, sockets)).rejects.toThrow(failure + ' failed');
    expect(server.listening).toBe(false);
    expect([...sockets].every(socket => socket.destroyed)).toBe(true);
    expect(order).toEqual(['terminateApp', 'uninstallApp']);
    expect(device.uninstallApp).toHaveBeenCalledTimes(1);
    expect(device.launchApp).not.toHaveBeenCalled();
  } finally {
    client.destroy();
  }
});

test('Android teardown retains terminate-only behavior after closing real sockets', async () => {
  const { server, sockets, client } = await fixture();
  const { device, order } = nativeDevice(server, undefined, 'android');
  try {
    await cleanupTlsFixture(device, server, sockets);
    expect(server.listening).toBe(false);
    expect([...sockets].every(socket => socket.destroyed)).toBe(true);
    expect(order).toEqual(['terminateApp']);
    expect(device.uninstallApp).not.toHaveBeenCalled();
    expect(device.clearKeychain).not.toHaveBeenCalled();
    expect(device.launchApp).not.toHaveBeenCalled();
  } finally {
    client.destroy();
  }
});
