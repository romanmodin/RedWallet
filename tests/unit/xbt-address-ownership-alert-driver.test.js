const { checkAddressOwnershipAlert } = require('../e2e/address-ownership-alert');

test.each([false, true])(
  'ownership result stays required and idle tracking resumes after leaving the focused screen: failure=%s',
  async fail => {
    const calls = [];
    let sync = true;
    let focusedScreen = true;
    const device = {
      disableSynchronization: async () => {
        calls.push('disable');
        sync = false;
      },
      enableSynchronization: async () => {
        if (focusedScreen) throw Error('idle tracking waits forever on the focused screen');
        calls.push('enable');
        sync = true;
      },
      launchApp: async () => {
        calls.push('failure cleanup');
        focusedScreen = false;
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
    const leaveAddressScreen = async () => {
      calls.push('leave and observe settings');
      focusedScreen = false;
    };
    const run = checkAddressOwnershipAlert({ device, element, by, expect: assertion, leaveAddressScreen });
    if (fail) await expect(run).rejects.toThrow('ownership result absent');
    else await run;
    expect(calls).toEqual([
      'disable',
      'CheckAddress',
      'None of the available wallets own the provided address.',
      ...(fail ? ['failure cleanup'] : ['OK', 'leave and observe settings']),
      'enable',
    ]);
    expect(sync).toBe(true);
  },
);
