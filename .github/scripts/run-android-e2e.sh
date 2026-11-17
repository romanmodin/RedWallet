#!/usr/bin/env bash
set -euo pipefail

artifacts_dir="${1:?Pass the artifacts directory}"
mkdir -p "$artifacts_dir"

# Run inside android-emulator-runner so diagnostics precede its emulator teardown.
# Cleanup must never turn a failed or timed-out suite into a successful run.
collect_diagnostics() {
  local result=$?
  trap - EXIT
  if command -v adb >/dev/null 2>&1; then
    timeout --signal=TERM --kill-after=5s 10s adb devices -l > "$artifacts_dir/emulator-devices.log" 2>&1 || true
    timeout --signal=TERM --kill-after=5s 15s adb logcat -d -t 500 > "$artifacts_dir/emulator-final-logcat.log" 2>&1 || true
  fi
  exit "$result"
}
trap collect_diagnostics EXIT

timeout --signal=TERM --kill-after=15s 180s bash .github/scripts/wait-for-android-ui.sh "$artifacts_dir/emulator-startup.log"
timeout --signal=TERM --kill-after=30s 15m npx detox test -c android.release.device tests/e2e/electrum-tls.spec.js --runTestsByPath --record-videos failing --record-logs failing --take-screenshots failing --headless --retries 0 --reuse --artifacts-location "$artifacts_dir/tls"
timeout --signal=TERM --kill-after=30s 30m npx detox test -c android.release.device tests/e2e/bluewallet.spec.js tests/e2e/bluewallet3.spec.js tests/e2e/xbt-wallet.spec.js --record-videos failing --record-logs failing --take-screenshots failing --headless --retries 0 --reuse --artifacts-location "$artifacts_dir"
