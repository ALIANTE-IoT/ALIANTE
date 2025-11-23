#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <COUNT> [BASE_PORT=5770] [-- <extra mavproxy args>]" >&2
  echo "Example: $0 3 5770 -- --console --map" >&2
  exit 1
}

[ $# -ge 1 ] || usage
COUNT="$1"; shift

# optional second arg is base port if numeric
BASE_PORT=5770
if [ $# -ge 1 ] && [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  BASE_PORT="$1"; shift
fi

# optional separator for extra args
if [ "${1:-}" = "--" ]; then shift; fi

EXTRA_ARGS=("$@")
if [ ${#EXTRA_ARGS[@]} -eq 0 ]; then
  EXTRA_ARGS=(--console --map)
fi

# Build masters
masters=()
for ((i=0; i<COUNT; i++)); do
  port=$((BASE_PORT + i))
  masters+=( "--master=tcp:127.0.0.1:${port}" )
done

echo "Starting MAVProxy with: ${masters[*]} ${EXTRA_ARGS[*]}" >&2
exec mavproxy.py "${masters[@]}" "${EXTRA_ARGS[@]}"
