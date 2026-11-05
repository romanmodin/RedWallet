#!/usr/bin/env bash
set -euo pipefail
app=com.romanmodin.redwallet.lightning
mkdir -p "$RUNNER_TEMP/lnd-regtest/diagnostics"
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb install android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -r -e class io.bluewallet.bluewallet.lightning.MainnetDeviceTest#publicSync "$app.test/androidx.test.runner.AndroidJUnitRunner" | tee "$RUNNER_TEMP/lnd-regtest/diagnostics/public-sync.log"
grep -q 'OK (1 test)' "$RUNNER_TEMP/lnd-regtest/diagnostics/public-sync.log"
