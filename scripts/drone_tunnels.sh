#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage:
  $0 start <user@host> <COUNT> [--mav-base 5770] [--zion 28081] [--no-servients] [--servient-base 19080] [--monitor-port 4173] [--no-monitor] [--ctrl ~/.ssh/drone-tunnels.sock]
  $0 stop  <user@host> [--ctrl ~/.ssh/drone-tunnels.sock]
  $0 status <user@host> [--ctrl ~/.ssh/drone-tunnels.sock]

Examples:
  $0 start debian@edgebox 3
  $0 start debian@edgebox 3 --no-monitor
  $0 stop debian@edgebox
  $0 status debian@edgebox
EOF
  exit 1
}

cmd="${1:-}"; [ -n "$cmd" ] || usage; shift || true

REMOTE=""
COUNT=""
MAV_BASE=5770
ZION_PORT=28081
SERVIENTS=1
SERVIENT_BASE=19080
MONITOR_PORT=4173
MONITOR=1
CTRL_DEFAULT="$HOME/.ssh/drone-tunnels.sock"
CTRL="$CTRL_DEFAULT"
EXTRA_PORTS=(4001 4000 3000)

parse_common() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --mav-base) MAV_BASE="${2:-}"; shift 2;;
      --zion) ZION_PORT="${2:-}"; shift 2;;
      --servients) SERVIENTS=1; shift;;
      --no-servients) SERVIENTS=0; shift;;
      --servient-base) SERVIENT_BASE="${2:-}"; shift 2;;
      --monitor-port) MONITOR_PORT="${2:-}"; shift 2;;
      --monitor) MONITOR=1; shift;;
      --no-monitor) MONITOR=0; shift;;
      --ctrl) CTRL="${2:-}"; shift 2;;
      *) break;;
    esac
  done
  echo ""
}

case "$cmd" in
  start)
    [ $# -ge 2 ] || usage
    REMOTE="$1"; COUNT="$2"; shift 2
    parse_common "$@"

    # Build -L forwards
    forwards=()
    for ((i=0; i<COUNT; i++)); do
      lp=$((MAV_BASE + i))
      forwards+=( -L "${lp}:127.0.0.1:${lp}" )
    done
    # Zion
    forwards+=( -L "${ZION_PORT}:127.0.0.1:${ZION_PORT}" )
    # Servients (optional)
    if [ "$SERVIENTS" -eq 1 ]; then
      for ((i=0; i<COUNT; i++)); do
        sp=$((SERVIENT_BASE + i))
        forwards+=( -L "${sp}:127.0.0.1:${sp}" )
      done
    fi
    # Monitor UI (optional)
    if [ "$MONITOR" -eq 1 ]; then
      forwards+=( -L "${MONITOR_PORT}:127.0.0.1:${MONITOR_PORT}" )
    fi
    # Additional services (tree analyzer, image host, web UI)
    for extra_port in "${EXTRA_PORTS[@]}"; do
      forwards+=( -L "${extra_port}:127.0.0.1:${extra_port}" )
    done

    # Start a single master session with all forwards, quietly in background
    echo "Opening SSH tunnels to ${REMOTE} via control socket: ${CTRL}" >&2
    ssh -f -N -M \
      -o ExitOnForwardFailure=yes \
      -o ControlMaster=auto \
      -o ControlPersist=yes \
      -o ControlPath="${CTRL}" \
      -o ServerAliveInterval=60 \
      -o ServerAliveCountMax=3 \
      -o StrictHostKeyChecking=no \
      "${forwards[@]}" \
      "${REMOTE}"
    echo "Tunnels up." >&2
    ;;

  stop)
    [ $# -ge 1 ] || usage
    REMOTE="$1"; shift
    parse_common "$@"
    echo "Closing SSH tunnels via control socket: ${CTRL}" >&2
    if ssh -S "${CTRL}" -O exit "${REMOTE}" 2>/dev/null; then
      echo "Tunnels closed." >&2
    else
      echo "No active control session found (or already closed)." >&2
    fi
    ;;

  status)
    [ $# -ge 1 ] || usage
    REMOTE="$1"; shift
    parse_common "$@"
    if ssh -S "${CTRL}" -O check "${REMOTE}" 2>&1; then
      :
    else
      echo "No active tunnel session (or control socket missing)." >&2
      exit 1
    fi
    ;;

  *)
    usage;;
esac
