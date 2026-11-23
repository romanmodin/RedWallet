const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const stages = new Set([
  'create-start',
  'generate-start',
  'generate-return',
  'save-start',
  'wait-existing-save',
  'transaction-realm-open',
  'transaction-realm-ready',
  'backup-realm-open',
  'backup-realm-ready',
  'save-complete',
  'save-error',
  'save-return',
  'navigate-backup',
]);

function readStages(raw) {
  const lines = raw.trimEnd().split('\n');
  if (lines[0] !== 'create-start 0' || lines.length > 128) return [];
  let previous = 0;
  for (const line of lines) {
    const match = /^([a-z-]+) (\d{1,9})$/.exec(line);
    if (!match || !stages.has(match[1]) || Number(match[2]) < previous) return [];
    previous = Number(match[2]);
  }
  return lines;
}

function prepareTrace(simulator) {
  if (process.env.REDWALLET_CREATE_TRACE !== '1' || !/^[\da-f-]{36}$/i.test(simulator)) return;
  try {
    const data = execFileSync('xcrun', ['simctl', 'get_app_container', simulator, 'com.romanmodin.redwallet', 'data'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    }).trim();
    if (!path.isAbsolute(data)) return;
    const file = path.join(data, 'Library', 'Caches', 'rw-e2e-create-stages.txt');
    rmSync(file, { force: true });
    return file;
  } catch {
    return undefined;
  }
}

function reportTrace(file) {
  if (!file) return;
  let stagesRead = [];
  try {
    stagesRead = readStages(readFileSync(file, 'utf8'));
  } catch {
    // A missing trace supplies no evidence about the app's last stage.
  }
  console.info('[wallet-e2e/create-stages]', stagesRead.length ? stagesRead.join(', ') : 'unavailable');
}

module.exports = { prepareTrace, readStages, reportTrace };
