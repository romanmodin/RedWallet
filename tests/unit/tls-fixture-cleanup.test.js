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

function nativeDevice(server, failure) {
  let restarted = false;
  let cleared = false;
  return {
    getPlatform: () => 'ios',
    clearKeychain: jest.fn(async () => {
      if (failure === 'clear') throw new Error('clear failed');
      cleared = true;
    }),
    launchApp: jest.fn(async options => {
      if (!cleared || !options.delete) throw new Error('saved endpoint reconnect after server closure');
      expect(options).toEqual({ delete: true, permissions: { notifications: 'NO' } });
      expect(server.listening).toBe(false);
      if (failure === 'launch') throw new Error('launch failed');
      restarted = true;
    }),
    enableSynchronization: jest.fn(async () => {
      if (!restarted) throw new Error('busy settings process');
      if (failure === 'sync') throw new Error('sync failed');
    }),
    terminateApp: jest.fn(async () => {
      if (failure === 'terminate') throw new Error('terminate failed');
    }),
  };
}

test('reproduces old cleanup ordering leaving a real server open on a synchronization failure', async () => {
  const { server, sockets, client } = await fixture();
  const device = nativeDevice(server);
  try {
    await expect(
      (async () => {
        await device.enableSynchronization();
        await device.terminateApp();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      })(),
    ).rejects.toThrow('busy settings process');
    expect(server.listening).toBe(true);
    expect(device.terminateApp).not.toHaveBeenCalled();
  } finally {
    await cleanupTlsFixture(device, server, sockets);
    client.destroy();
  }
});

test('closes real listening and accepted sockets before restoring synchronization on a new process', async () => {
  const { server, sockets, client } = await fixture();
  const device = nativeDevice(server);
  try {
    await cleanupTlsFixture(device, server, sockets);
    expect(server.listening).toBe(false);
    expect([...sockets].every(socket => socket.destroyed)).toBe(true);
    expect(device.launchApp).toHaveBeenCalledTimes(1);
    expect(device.enableSynchronization).toHaveBeenCalledTimes(1);
    expect(device.terminateApp).toHaveBeenCalledTimes(1);
  } finally {
    client.destroy();
  }
});

test.each(['clear', 'launch', 'sync', 'terminate'])('native %s failure still closes the real server and fails the check', async failure => {
  const { server, sockets, client } = await fixture();
  const device = nativeDevice(server, failure);
  try {
    await expect(cleanupTlsFixture(device, server, sockets)).rejects.toThrow(failure + ' failed');
    expect(server.listening).toBe(false);
    expect([...sockets].every(socket => socket.destroyed)).toBe(true);
    expect(device.terminateApp).toHaveBeenCalledTimes(1);
    if (failure === 'clear' || failure === 'launch') expect(device.enableSynchronization).not.toHaveBeenCalled();
  } finally {
    client.destroy();
  }
});

test('Android teardown closes the server without adding an app restart', async () => {
  const { server, sockets, client } = await fixture();
  const device = nativeDevice(server);
  device.getPlatform = () => 'android';
  try {
    await cleanupTlsFixture(device, server, sockets);
    expect(server.listening).toBe(false);
    expect(device.launchApp).not.toHaveBeenCalled();
    expect(device.enableSynchronization).not.toHaveBeenCalled();
    expect(device.terminateApp).toHaveBeenCalledTimes(1);
  } finally {
    client.destroy();
  }
});

test('previous new-process-only cleanup retains the now-closed endpoint and cannot finish launch', async () => {
  const { server, sockets, client } = await fixture();
  const device = nativeDevice(server);
  try {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await expect(device.launchApp({ newInstance: true })).rejects.toThrow('saved endpoint reconnect');
    expect(device.enableSynchronization).not.toHaveBeenCalled();
  } finally {
    client.destroy();
  }
});
