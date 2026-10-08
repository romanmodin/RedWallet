const DEFAULT_CASE_TIMEOUT_MS = 15 * 60 * 1000;
const DELETE_CASE_TIMEOUT_MS = 18 * 60 * 1000;

export function lifecycleCaseTimeoutMs(stage: string): number {
  return stage === 'delete' ? DELETE_CASE_TIMEOUT_MS : DEFAULT_CASE_TIMEOUT_MS;
}
