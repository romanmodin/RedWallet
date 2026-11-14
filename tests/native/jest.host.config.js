// Exercise the native fixture with Detox's module transforms before booting iOS.
const native = require('../e2e/jest.config');
module.exports = {
  ...native,
  globalSetup: undefined,
  globalTeardown: undefined,
  testEnvironment: 'node',
  setupFilesAfterEnv: [],
  reporters: ['default'],
  testMatch: ['<rootDir>/native/standard-hardware-host.test.ts'],
};
