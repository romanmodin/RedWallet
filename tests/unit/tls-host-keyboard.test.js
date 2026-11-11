const { settleIosHostKeyboard } = require('../e2e/tls-host-keyboard');

function fixture(platform = 'ios') {
  let dismissalRequested = false;
  let visible = true;
  let finishAnimation;
  const closed = new Promise(resolve => {
    finishAnimation = () => {
      if (!dismissalRequested) throw new Error('keyboard was never dismissed');
      visible = false;
      resolve();
    };
  });
  const by = {
    type: name => ({
      type: name,
      and: value => ({ type: name, value: value.value }),
    }),
    value: value => ({ value }),
  };
  const element = matcher => {
    if (matcher.type === 'RCTUITextField') {
      return {
        tapReturnKey: async () => {
          if (matcher.value !== '127.0.0.1') throw new Error('edited host not found');
          dismissalRequested = true;
        },
      };
    }
    if (matcher.type !== 'UIKeyboardLayoutStar') throw new Error('wrong keyboard observation');
    return { keyboard: true };
  };
  const waitFor = view => ({
    not: {
      toBeVisible: () => ({
        withTimeout: timeout => {
          if (!view.keyboard || !dismissalRequested || timeout !== 15000) throw new Error('invalid settlement barrier');
          return closed;
        },
      }),
    },
  });
  return {
    api: { device: { getPlatform: () => platform }, by, element, waitFor },
    finishAnimation,
    keyboardVisible: () => visible,
  };
}

test('port scrolling cannot begin while Return dismissal is still animating', async () => {
  const f = fixture();
  let reachedPort = false;
  const editing = settleIosHostKeyboard(f.api, '127.0.0.1').then(() => {
    if (f.keyboardVisible()) throw new Error('port is still clipped by keyboard');
    reachedPort = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(reachedPort).toBe(false);
  f.finishAnimation();
  await editing;
  expect(reachedPort).toBe(true);
});

test('matching the old default host fails before port editing rather than hiding a setup error', async () => {
  const f = fixture();
  await expect(settleIosHostKeyboard(f.api, 'fulcrum.kilombino.com')).rejects.toThrow('edited host not found');
  expect(f.keyboardVisible()).toBe(true);
});

test('an unsuccessful native keyboard wait propagates and cannot reach port editing', async () => {
  const f = fixture();
  f.api.waitFor = () => ({
    not: {
      toBeVisible: () => ({
        withTimeout: async () => {
          throw new Error('keyboard still visible');
        },
      }),
    },
  });
  await expect(settleIosHostKeyboard(f.api, '127.0.0.1')).rejects.toThrow('keyboard still visible');
  expect(f.keyboardVisible()).toBe(true);
});

test('Android retains its existing editing path', async () => {
  const f = fixture('android');
  f.api.element = () => {
    throw new Error('iOS API used on Android');
  };
  await settleIosHostKeyboard(f.api, '10.0.2.2');
  expect(f.keyboardVisible()).toBe(true);
});
