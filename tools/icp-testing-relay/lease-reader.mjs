import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function parseLease(value) {
  const record = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (record && typeof record.deadline_ms === 'number' && !Number.isSafeInteger(record.deadline_ms)) throw new Error('Unsafe deadline');
  if (!record || typeof record.active !== 'boolean' ||
      typeof record.ios_published !== 'boolean' || typeof record.android_published !== 'boolean' ||
      !/^[0-9]+$/.test(String(record.deadline_ms))) throw new Error('Invalid lease');
  return { ...record, deadline_ms: BigInt(record.deadline_ms) };
}

export function createLeaseReader({ canisterId, cwd }) {
  if (!/^[a-z0-9-]+$/.test(canisterId)) throw new Error('Invalid canister ID');
  return async () => {
    const { stdout } = await run('dfx', ['canister', '--network', 'ic', 'call',
      canisterId, 'get_lease', '()', '--output', 'json'], {
      cwd, timeout: 15000, maxBuffer: 16384,
    });
    return parseLease(JSON.parse(stdout));
  };
}
