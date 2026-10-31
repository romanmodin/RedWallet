/** @jest-environment node */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

test('real TLS runner isolates cases, kills timed-out children, preserves the matrix and never retries', () => {
  const output = execFileSync('python3', ['.github/scripts/tests/test-ios-tls-runner.py'], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect(output).toContain('[tls-runner] finished private-ca exit=124');
  expect(output).toContain('[tls-runner] finished replaced exit=0');
}, 25000);

test('both default and explicitly focused iOS workflow paths use the bounded TLS runner', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/e2e-ios.yml'), 'utf8');
  expect(workflow.match(/python3 \.github\/scripts\/run-ios-tls\.py/g)).toHaveLength(2);
  expect(workflow).toMatch(/name: Run TLS tests\n\s+timeout-minutes: 90/);
});
