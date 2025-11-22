#!/usr/bin/env bash
set -euo pipefail

#config from env
HOME_LAT="${HOME_LAT:--35.363261}"
HOME_LON="${HOME_LON:-149.165230}"
HOME_ALT="${HOME_ALT:-10}"
HOME_HDG="${HOME_HDG:-0}"
SIM_SPEEDUP="${SIM_SPEEDUP:-1}"
GCS_TCP_PORT="${GCS_TCP_PORT:-5770}"
SYSID="${SYSID:-1}"
M2R_PORT="${M2R_PORT:-14551}"

# optional EEPROM wipe to force params load once
WIPE_FLAG=""
if [ "${WIPE_EEPROM:-0}" = "1" ]; then
  echo "[entrypoint] EEPROM wipe requested"
  WIPE_FLAG="-w"
fi

# avoid Git safe.directory warnings
git config --global --add safe.directory /opt/ardupilot || true

# write param file (ArduCopter 4.7+)
echo "MAV_SYSID ${SYSID}" > /opt/sysid.parm

# Build MAVProxy args as a SINGLE LINE (important or it will break everything!)
MP_ARGS="--daemon --out=tcpin:0.0.0.0:${GCS_TCP_PORT} --out=udp:127.0.0.1:14551"
echo "[entrypoint] MAVProxy args: ${MP_ARGS}"

# Run sim_vehicle in the foreground so the container stays up
exec /opt/ardupilot/Tools/autotest/sim_vehicle.py \
  -v ArduCopter \
  -l "${HOME_LAT},${HOME_LON},${HOME_ALT},${HOME_HDG}" \
  --add-param-file=/opt/sysid.parm \
  --sysid "${SYSID}" \
  --speedup "${SIM_SPEEDUP}" \
  --no-rebuild \
  ${WIPE_FLAG} \
  --mavproxy-args="${MP_ARGS}"
