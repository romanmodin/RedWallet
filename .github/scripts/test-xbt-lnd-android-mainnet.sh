#!/usr/bin/env bash
set -euo pipefail
app="${XBT_ANDROID_APP_ID:-com.romanmodin.redwallet.lightning}"
case "$app" in
  com.romanmodin.redwallet|com.romanmodin.redwallet.lightning) ;;
  *) echo "Unexpected public Lightning app package" >&2; exit 1 ;;
esac
mkdir -p "$RUNNER_TEMP/lnd-regtest/diagnostics"
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb install android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -r -e class io.bluewallet.bluewallet.lightning.MainnetDeviceTest "$app.test/androidx.test.runner.AndroidJUnitRunner" | tee "$RUNNER_TEMP/lnd-regtest/diagnostics/public-sync.log"
grep -q 'OK (2 tests)' "$RUNNER_TEMP/lnd-regtest/diagnostics/public-sync.log"
