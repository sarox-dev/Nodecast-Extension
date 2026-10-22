#!/usr/bin/env sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir="$root_dir/dist/firefox"

rm -rf "$build_dir"
mkdir -p "$build_dir/icons"
cp "$root_dir"/*.js "$root_dir"/*.html "$root_dir"/*.css "$root_dir"/*.png "$root_dir/LICENSE" "$build_dir/"
cp "$root_dir/icons/"* "$build_dir/icons/"
cp "$root_dir/manifest.firefox.json" "$build_dir/manifest.json"

printf '%s\n' "Firefox extension built at: $build_dir"
printf '%s\n' "LibreWolf: open about:debugging#/runtime/this-firefox and load $build_dir/manifest.json"
