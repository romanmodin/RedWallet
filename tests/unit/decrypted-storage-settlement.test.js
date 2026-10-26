import { verifyDecryptedStorage } from '../e2e/decrypted-storage-settlement';
test('checks actual wallet before restart and password absence plus actual wallet after restart', async () => {
  const calls = [];
  let restarted = false;
  await verifyDecryptedStorage({
    home: async () => calls.push('home'),
    wallet: async () => calls.push('wallet'),
    restart: async () => {
      restarted = true;
      calls.push('restart');
    },
    passwordAbsent: async () => {
      expect(restarted).toBe(true);
      calls.push('passwordAbsent');
    },
  });
  expect(calls).toEqual(['home', 'wallet', 'restart', 'passwordAbsent', 'home', 'wallet']);
});
test.each(['home', 'wallet', 'restart', 'passwordAbsent'])('propagates %s failure without retry or bypass', async fail => {
  const failure = new Error(fail);
  const methods = Object.fromEntries(
    ['home', 'wallet', 'restart', 'passwordAbsent'].map(name => [
      name,
      jest.fn(async () => {
        if (name === fail) throw failure;
      }),
    ]),
  );
  await expect(verifyDecryptedStorage(methods)).rejects.toBe(failure);
  expect(methods[fail]).toHaveBeenCalledTimes(1);
  if (fail === 'home' || fail === 'wallet') expect(methods.restart).not.toHaveBeenCalled();
});
