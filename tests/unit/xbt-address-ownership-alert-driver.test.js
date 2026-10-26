const { checkAddressOwnershipAlert } = require('../e2e/address-ownership-alert');
test.each([false, true])('native alert driver keeps ownership assertion and restores synchronization on failure=%s', async fail => {
  const calls = [];
  let sync = true;
  const device = {
    disableSynchronization: async () => {
      calls.push('disable');
      sync = false;
    },
    enableSynchronization: async () => {
      calls.push('enable');
      sync = true;
    },
  };
  const by = { id: x => x, text: x => x };
  const element = id => ({
    id,
    tap: async () => {
      if (sync) throw Error('tap waits for alert dismissal');
      calls.push(id);
    },
  });
  const assertion = item => ({
    toBeVisible: async () => {
      calls.push(item.id);
      if (fail) throw Error('ownership result absent');
    },
  });
  const run = checkAddressOwnershipAlert({ device, element, by, expect: assertion });
  if (fail) await expect(run).rejects.toThrow('ownership result absent');
  else await run;
  expect(calls).toEqual([
    'disable',
    'CheckAddress',
    'None of the available wallets own the provided address.',
    ...(!fail ? ['OK'] : []),
    'enable',
  ]);
  expect(sync).toBe(true);
});
