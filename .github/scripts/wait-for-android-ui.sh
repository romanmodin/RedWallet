#!/usr/bin/env bash
# Wait for fresh-emulator storage and boot services before Detox starts recording.
# Fail on a System UI ANR instead of dismissing its dialog or weakening UI checks.
set -euo pipefail

log_path=${1:?Pass the startup diagnostics path}
mkdir -p "$(dirname "$log_path")"
exec > >(tee "$log_path") 2>&1

adb_command=(adb -s "${ANDROID_SERIAL:-emulator-5554}")
deadline=$((SECONDS + 180))
stable=0

while ((SECONDS < deadline)); do
  if ! events=$(timeout 10s "${adb_command[@]}" logcat -b events -d -s am_anr:I); then
    stable=0
  elif grep -Fq 'com.android.systemui' <<<"$events"; then
    printf '::error::Fresh emulator recorded a System UI ANR before the UI tests.\n'
    printf '%s\n' "$events"
    exit 1
  elif boot=$(timeout 10s "${adb_command[@]}" shell getprop sys.boot_completed | tr -d '\r') &&
    [[ "$boot" == 1 ]] &&
    timeout 10s "${adb_command[@]}" shell 'probe=/sdcard/redwallet-ci-ready.txt; printf ready > "$probe" && [ "$(cat "$probe")" = ready ] && rm "$probe"'; then
    stable=$((stable + 1))
    printf 'Emulator boot and external-storage recording probe passed (%s/5).\n' "$stable"
    if ((stable >= 5)); then
      printf 'Fresh emulator is ready for the unchanged Detox TLS and wallet assertions.\n'
      exit 0
    fi
  else
    stable=0
  fi
  sleep 2
done

printf '::error::Fresh emulator boot/storage did not become ready within 180 seconds.\n'
exit 1
