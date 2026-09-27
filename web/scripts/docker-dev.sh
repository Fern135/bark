#!/bin/sh
set -eu

for package in engine scripting web; do
  target="/app/$package/node_modules"
  source="/opt/dependencies/$package"
  if ! cmp -s "$source/.image-stamp" "$target/.image-stamp"; then
    echo "$package: node_modules volume is older than the image; refreshing it"
    find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$source/." "$target/"
  fi
done

exec npm run dev -- --hostname 0.0.0.0 --port "${PORT:-3000}"
