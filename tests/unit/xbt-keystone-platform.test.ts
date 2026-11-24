describe('Keystone Send device and distribution eligibility', () => {
  it.each([
    ['ios', 'phone', true, true],
    ['ios', 'phone', false, false],
    ['ios', 'phone', undefined, false],
    ['ios', 'phone', 'true', false],
    ['ios', 'pad', true, false],
    ['ios', undefined, true, false],
    ['android', 'phone', true, false],
  ])('handles %s device %s with internal flag %s', (os, idiom, flag, eligible) => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        Platform: { OS: os, constants: { interfaceIdiom: idiom } },
        NativeModules: { RedWalletSeparationHTTP: flag === undefined ? undefined : { internalKeystone: flag } },
      }));
      expect(require('../../class/xbt/standard-hardware-platform.ios').STANDARD_HARDWARE_RELEASE_ENABLED).toBe(eligible);
    });
  });
});
