#!/usr/bin/env bash
set -euo pipefail
out="$(realpath -m "${1:?output AAR path required}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q
git -C "$work" fetch --depth=1 https://github.com/Kilombino/lnd.git cae303b36594a2c48c9ce0cbb238672e3a1b284e
git -C "$work" checkout --detach -q FETCH_HEAD
cd "$work"
mobile_version=v0.0.0-20261011034528-197770444867
export GOBIN="$work/bin"
export PATH="$GOBIN:$PATH"
go install "golang.org/x/mobile/cmd/gomobile@$mobile_version"
go install "golang.org/x/mobile/cmd/gobind@$mobile_version"
go get "golang.org/x/mobile/bind@$mobile_version"
mkdir -p "$(dirname "$out")"
GOFLAGS=-mod=mod gomobile bind -trimpath -target=android/arm64,android/amd64 -androidapi 26 \
  -tags='mobile signrpc walletrpc chainrpc invoicesrpc routerrpc peersrpc neutrinorpc' \
  -ldflags="-s -w -extldflags '-Wl,-z,max-page-size=16384'" -o "$out" ./mobile
unzip -tq "$out"
