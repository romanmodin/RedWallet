describe('Keystone Send device eligibility', () => {
  it.each([
    ['ios', 'phone', true],
    ['ios', 'pad', false],
    ['ios', undefined, false],
    ['android', 'phone', false],
  ])('handles %s device %s', (os, idiom, eligible) => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: os, constants: { interfaceIdiom: idiom } } }));
      expect(require('../../class/xbt/standard-hardware-platform.ios').STANDARD_HARDWARE_RELEASE_ENABLED).toBe(eligible);
    });
  });
});
