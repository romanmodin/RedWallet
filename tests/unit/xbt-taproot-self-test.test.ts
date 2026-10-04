import { runTaprootSigningSelfTest } from '../../class/xbt/taproot-self-test';

it('runs the offline public cold/RBF/CPFP checks used by the native wallet self-test', () => {
  expect(() => runTaprootSigningSelfTest()).not.toThrow();
});
