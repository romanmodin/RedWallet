#!/usr/bin/env bash
# Build from the same mobile source, tags and Go binding revision as the iOS release.
set -euo pipefail
src=${1:?pinned clean LND checkout required}
out=${2:?new output directory required}
here=$(cd "$(dirname "$0")" && pwd)
test "$(git -C "$src" rev-parse HEAD)" = cae303b36594a2c48c9ce0cbb238672e3a1b284e
test -z "$(git -C "$src" status --porcelain)"
test "$(go env GOVERSION)" = go1.27.3
mkdir "$out"
out=$(cd "$out" && pwd)
git -C "$src" apply "$here/peer-funding.patch"
cp "$here"/splice_output{,_test}.go "$src/lnwallet/btcwallet/"
export GOBIN="$out/go-bin" GOTOOLCHAIN=local GOFLAGS=-mod=mod
export PATH="$GOBIN:$PATH"
mobile=v0.0.0-20261011034528-197770444867
go install "golang.org/x/mobile/cmd/gomobile@$mobile"
go install "golang.org/x/mobile/cmd/gobind@$mobile"
cd "$src"
gomobile init
tags='mobile signrpc walletrpc chainrpc invoicesrpc routerrpc peersrpc neutrinorpc watchtowerrpc wtclientrpc offersrpc'
go test ./lnwallet/btcwallet -run '^TestSpliceOutputInBlock$'
gomobile bind -target=ios,iossimulator -iosversion 16.0 -tags="$tags" -ldflags='-s -w' -o "$out/Lndmobile.xcframework" ./mobile
cd "$out"
find Lndmobile.xcframework -exec touch -h -t 202601010000 {} +
find Lndmobile.xcframework \( -type f -o -type l \) | LC_ALL=C sort | zip -q -X -y -9 Lndmobile.xcframework.zip -@
shasum -a 256 Lndmobile.xcframework.zip > Lndmobile.xcframework.zip.sha256
