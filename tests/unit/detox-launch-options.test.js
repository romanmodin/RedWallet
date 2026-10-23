'use strict';

const { DETOX_URL_BLACKLIST_REGEX, withDetoxLaunchBlacklist } = require('../e2e/detox-launch-options');

describe('Detox launch options', () => {
  it('installs the startup URL blacklist before the app launches', () => {
    expect(withDetoxLaunchBlacklist()).toEqual({
      launchArgs: { detoxURLBlacklistRegex: DETOX_URL_BLACKLIST_REGEX },
    });
  });

  it('preserves launch configuration while enforcing the required blacklist', () => {
    const original = {
      delete: true,
      permissions: { notifications: 'NO' },
      launchArgs: { existing: 'value', detoxURLBlacklistRegex: 'stale' },
    };

    expect(withDetoxLaunchBlacklist(original)).toEqual({
      delete: true,
      permissions: { notifications: 'NO' },
      launchArgs: {
        existing: 'value',
        detoxURLBlacklistRegex: DETOX_URL_BLACKLIST_REGEX,
      },
    });
    expect(original.launchArgs.detoxURLBlacklistRegex).toBe('stale');
  });
});
