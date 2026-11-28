#!/usr/bin/env bash
set -euo pipefail
# Only a copy of the packaged simulator binary receives the offline test bundle.
temp=$(mktemp -d)
app="$temp/BlueWallet.app"
ditto ios/build/Build/Products/Release-iphonesimulator/BlueWallet.app "$app"
test "$(/usr/libexec/PlistBuddy -c 'Print :DTPlatformName' "$app/Info.plist")" = iphonesimulator
id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")
node node_modules/react-native/cli.js bundle --config tests/native/metro-ancestry.cjs --sourcemap-output "$temp/probe.map" --platform ios --dev false --entry-file tests/native/mined-ancestry-ios.js --bundle-output "$temp/probe.js"
# The qualification bundle must contain the offline transport exclusively.
jq -e '(.sources | any(endswith("/mined-ancestry-offline-http.ts"))) and
  (.sources | all(test("/class/xbt/separation-http(\\.native)?\\.ts$") | not))' "$temp/probe.map" >/dev/null
node_modules/hermes-compiler/hermesc/osx-bin/hermesc -O -emit-binary -out "$app/main.jsbundle" "$temp/probe.js"
codesign --force --sign - "$app"
read -r runtime device_type < <(xcrun simctl list devices available -j | jq -r '[.devices | to_entries[] | select(.key|contains(".iOS-")) | .key as $runtime | .value[] | select(.deviceTypeIdentifier|contains(".iPhone-")) | [$runtime,.deviceTypeIdentifier]] | last | @tsv')
sim=$(xcrun simctl create AncestryCheck "$device_type" "$runtime")
trap 'xcrun simctl delete "$sim"' EXIT
xcrun simctl boot "$sim"
xcrun simctl bootstatus "$sim" -b
xcrun simctl install "$sim" "$app"
xcrun simctl launch "$sim" "$id"
data=$(xcrun simctl get_app_container "$sim" "$id" data)
report="$data/Documents/ancestry-result.json"
for ((i=0; i<90; i++)); do
  if [[ -s "$report" ]]; then break; fi
  sleep 1
done
jq -e '. == {"hermes":true,"linked":true,"unrelatedRejected":true,"secondParentDiscovered":true,"unsignedOneXbtVerified":true,"partialHistoryVerified":true,"twoInputsVerified":true,"preExpiryMatureSendVerified":true,"replacedTipRejected":true}' "$report"
jq --arg head "$(git rev-parse HEAD)" --arg runtime "$runtime" '. + {sourceCommit:$head,runtime:$runtime}' "$report" > ios-ancestry-result.json
