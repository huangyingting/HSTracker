#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  if [ "${HS_TRACKER_RELEASE_VOLUME_PATH}" != "/data/releases" ]; then
    printf '{"timestamp":"%s","level":"error","event":"runtime-volume-path-rejected"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
    exit 78
  fi
  if [ -L "${HS_TRACKER_RELEASE_VOLUME_PATH}" ]; then
    printf '{"timestamp":"%s","level":"error","event":"runtime-volume-symlink-rejected"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
    exit 78
  fi
  mkdir -p "${HS_TRACKER_RELEASE_VOLUME_PATH}"
  chown node:node "${HS_TRACKER_RELEASE_VOLUME_PATH}"
  printf '{"timestamp":"%s","level":"info","event":"runtime-volume-ready"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
