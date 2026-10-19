#!/usr/bin/env bash
set -euo pipefail

probe_log=/sdcard/redwallet-detox-probe.log
probe_video=/sdcard/redwallet-detox-probe.mp4

# Boot completion does not guarantee that the external-storage recorder is ready.
# Bound each adb call too: an unresponsive emulator must not stall the preflight.
bounded_adb() {
  timeout --kill-after=1s 5s adb "$@"
}

cleanup_probe() {
  bounded_adb shell rm -f "$probe_log" "$probe_video" >/dev/null 2>&1 || true
}

artifacts_are_writable() {
  cleanup_probe
  bounded_adb shell logcat -d -f "$probe_log" >/dev/null 2>&1 || return 1
  bounded_adb shell screenrecord --time-limit 1 "$probe_video" >/dev/null 2>&1 || return 1
  bounded_adb shell test -e "$probe_log" || return 1
  bounded_adb shell test -e "$probe_video" || return 1
  cleanup_probe
}

for attempt in $(seq 1 30); do
  if artifacts_are_writable; then
    echo "Android artifact recording is ready (attempt $attempt/30)."
    export REDWALLET_BACKEND_BIN="$RUNNER_TEMP/redwallet-backend-bin"
    exec npx detox test -c android.release.device tests/e2e/native-live-lifecycle.spec.ts \
      --runTestsByPath \
      --record-videos failing \
      --record-logs failing \
      --take-screenshots failing \
      --headless \
      --retries 0 \
      --reuse \
      --artifacts-location artifacts/native-lifecycle/detox-android
  fi
  echo "Android artifact recording is not ready (attempt $attempt/30); retrying in 2 seconds."
  sleep 2
done

cleanup_probe
echo "Android artifact recording remained unavailable after 30 bounded checks." >&2
exit 1
