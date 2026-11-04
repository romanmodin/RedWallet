#!/usr/bin/env bash
set -euo pipefail
dir="$RUNNER_TEMP/lnd-regtest"
mkdir -p "$dir/tools" "$dir/data"
asset=tests/native/backend-assets.json
curl -fsSL --retry 2 "$(jq -r '.knots.linux.url' "$asset")" -o "$dir/knots.tar.gz"
printf '%s  %s\n' "$(jq -r '.knots.linux.sha256' "$asset")" "$dir/knots.tar.gz" | sha256sum -c -
tar xzf "$dir/knots.tar.gz" --strip-components=1 -C "$dir/tools"
"$dir/tools/bin/bitcoind" -datadir="$dir/data" -regtest -server -daemonwait -bind=127.0.0.1:18444 -rpcbind=127.0.0.1 -rpcallowip=127.0.0.1 -listenonion=0 -connect=0 -dnsseed=0 -discover=0 -blockfilterindex=1 -peerblockfilters=1 -fallbackfee=0.00001 -testactivationheight=blake2b@150
cli=("$dir/tools/bin/bitcoin-cli" "-datadir=$dir/data" -regtest -rpcwait)
"${cli[@]}" createwallet fixture >/dev/null
"${cli[@]}" generatetoaddress 151 "$("${cli[@]}" getnewaddress)" >/dev/null
header=$("${cli[@]}" getblockheader "$("${cli[@]}" getblockhash 150)" false)
test "${#header}" -eq 328
cookie=$(<"$dir/data/regtest/.cookie")
"$dir/ln-bin/lnd" --lnddir="$dir/ln-peer" --bitcoin.regtest --bitcoin.blake2b-activation-height=150 --bitcoin.node=bitcoind --bitcoind.rpchost=127.0.0.1:18443 --bitcoind.rpcuser="${cookie%%:*}" --bitcoind.rpcpass="${cookie#*:}" --bitcoind.rpcpolling --bitcoind.blockpollinginterval=500ms --rpclisten=127.0.0.1:11009 --listen=127.0.0.1:19735 --noseedbackup --nobootstrap --norest --debuglevel=info,FNDG=debug >"$dir/peer.log" 2>&1 &
for i in {1..90}; do
  "$dir/ln-bin/lncli" --network=regtest --rpcserver=127.0.0.1:11009 --lnddir="$dir/ln-peer" getinfo >/dev/null 2>&1 && break
  sleep 2
done
python3 .github/scripts/xbt-lnd-regtest-peer.py "$dir" >"$dir/fixture.log" 2>&1 &
for p in 18444 19735 18149; do adb reverse "tcp:$p" "tcp:$p"; done
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb install android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
app=com.romanmodin.redwallet.regtest
collect_failure() {
  mkdir -p "$dir/diagnostics"
  cp "$dir/instrumentation.log" "$dir/diagnostics/instrumentation.log"
  cp "$dir/fixture.log" "$dir/diagnostics/fixture.log"
  grep -E 'ERR|WRN|funding|synced|synchroniz' "$dir/ln-peer/logs/bitcoin/regtest/lnd.log" | tail -150 > "$dir/diagnostics/peer.log" || true
  adb exec-out run-as "$app" cat no_backup/XBTLightning-regtest/logs/bitcoin/regtest/lnd.log | grep -E 'ERR|WRN|funding|synced|synchroniz' | tail -150 > "$dir/diagnostics/mobile.log" || true
}
run_case() {
  adb shell am instrument -w -r -e class "io.bluewallet.bluewallet.lightning.LightningDeviceTest#$1" "$app.test/androidx.test.runner.AndroidJUnitRunner" | tee "$dir/instrumentation.log"
  if ! grep -q 'OK (1 test)' "$dir/instrumentation.log"; then
    collect_failure
    return 1
  fi
}
run_case payments
for f in recovery.rwln identity balance; do adb exec-out run-as "$app" cat "cache/$f" > "$dir/$f"; done
adb shell am force-stop "$app"
adb shell pm clear "$app"
adb shell run-as "$app" mkdir -p cache
for f in recovery.rwln identity balance; do adb shell -T "run-as $app sh -c 'cat > cache/$f'" < "$dir/$f"; done
run_case restore
