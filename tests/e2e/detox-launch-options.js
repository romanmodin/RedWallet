'use strict';

const DETOX_URL_BLACKLIST_REGEX =
  '(".*arkade\\.computer/v1/indexer/script/subscription.*",".*groundcontrol-bluewallet\\.herokuapp\\.com.*")';

function withDetoxLaunchBlacklist(options = {}, platform = 'ios') {
  // This is an iOS launch-argument encoding; Android sends it through adb's shell.
  // Both platforms still receive setURLBlacklist after launch in setup.js.
  if (platform !== 'ios') return options;
  return {
    ...options,
    launchArgs: {
      ...(options.launchArgs || {}),
      detoxURLBlacklistRegex: DETOX_URL_BLACKLIST_REGEX,
    },
  };
}

module.exports = { DETOX_URL_BLACKLIST_REGEX, withDetoxLaunchBlacklist };
