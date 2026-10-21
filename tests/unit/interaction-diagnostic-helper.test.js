import { diagnosticStep } from '../e2e/interaction-diagnostic-helper';

test('reports completion and returns the actual result once', async () => {
  const action = jest.fn().mockResolvedValue('observed');
  const report = jest.fn();
  await expect(diagnosticStep('probe', action, 100, report)).resolves.toBe('observed');
  expect(action).toHaveBeenCalledTimes(1);
  expect(report.mock.calls.map(([entry]) => entry.state)).toEqual(['start', 'done']);
});

test('propagates an observation failure without retrying or calling it a timeout', async () => {
  const error = new Error('transport');
  const action = jest.fn().mockRejectedValue(error);
  const report = jest.fn();
  await expect(diagnosticStep('probe', action, 100, report)).rejects.toBe(error);
  expect(action).toHaveBeenCalledTimes(1);
  expect(report.mock.calls.map(([entry]) => entry.state)).toEqual(['start', 'failed']);
});

test('a never-resolving native action fails with its exact step and never retries', async () => {
  const action = jest.fn(() => new Promise(() => {}));
  const report = jest.fn();
  await expect(diagnosticStep('rotation request', action, 10, report)).rejects.toThrow('Diagnostic timeout: rotation request after 10ms');
  expect(action).toHaveBeenCalledTimes(1);
  expect(report.mock.calls.map(([entry]) => entry.state)).toEqual(['start', 'failed']);
});
