#!/bin/sh
set -eu

content_dir="${CONTENT_DIR:-/app/content}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$content_dir"

  if ! su-exec node test -w "$content_dir"; then
    chown node:node "$content_dir"
  fi

  exec su-exec node "$@"
fi

exec "$@"
