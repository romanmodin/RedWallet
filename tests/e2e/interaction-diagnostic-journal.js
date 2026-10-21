import fs from 'node:fs';
import path from 'node:path';
import { diagnosticStep } from './interaction-diagnostic-helper';

const directory = path.resolve('artifacts/interaction-diagnostics');
export function step(label, action, timeoutMs = 30000) {
  return diagnosticStep(label, action, timeoutMs, event => {
    fs.mkdirSync(directory, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    fs.appendFileSync(path.join(directory, 'steps.jsonl'), line + '\n');
    console.info('[interaction-diagnostic]', line);
  });
}
