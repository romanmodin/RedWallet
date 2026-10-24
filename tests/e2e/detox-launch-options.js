'use strict';

const DETOX_URL_BLACKLIST_REGEX =
  '(".*arkade\\.computer/v1/indexer/script/subscription.*",".*groundcontrol-bluewallet\\.herokuapp\\.com.*")';

function withDetoxLaunchBlacklist(options = {}) {
  return {
    ...options,
    launchArgs: {
      ...(options.launchArgs || {}),
      detoxURLBlacklistRegex: DETOX_URL_BLACKLIST_REGEX,
    },
  };
}

module.exports = { DETOX_URL_BLACKLIST_REGEX, withDetoxLaunchBlacklist };
