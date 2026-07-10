#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${MERCURY_RESTART_STATE_DIR:-${ROOT_DIR}/.nx}"
PID_FILE="${STATE_DIR}/mercury-restart.pid"
HEALTH_TIMEOUT="${MERCURY_RESTART_HEALTH_TIMEOUT:-60}"
DEV_PID=""
CLEANUP_STARTED=0

log() {
  printf '[mercury] %s\n' "$1"
}

warn() {
  printf '[mercury] warning: %s\n' "$1" >&2
}

die() {
  printf '[mercury] error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  local command_name="$1"

  command -v "${command_name}" >/dev/null 2>&1 ||
    die "required command not found: ${command_name}"
}

validate_environment() {
  local command_name

  [[ "${HEALTH_TIMEOUT}" =~ ^[1-9][0-9]*$ ]] ||
    die "MERCURY_RESTART_HEALTH_TIMEOUT must be a positive integer"

  for command_name in npm bun docker lsof; do
    require_command "${command_name}"
  done

  docker info >/dev/null 2>&1 || die "Docker is not reachable"
  [[ -f "${ROOT_DIR}/apps/web/.env" ]] || die "apps/web/.env is required"
  [[ -f "${ROOT_DIR}/apps/native/.env" ]] || die "apps/native/.env is required"
}

cleanup() {
  local exit_status="$1"
  local recorded_pid=""

  if ((CLEANUP_STARTED)); then
    return
  fi

  CLEANUP_STARTED=1
  trap - EXIT
  trap '' INT TERM
  set +e

  if [[ -n "${DEV_PID}" ]] && kill -0 "${DEV_PID}" 2>/dev/null; then
    kill -TERM "${DEV_PID}" 2>/dev/null
  fi

  if [[ -n "${DEV_PID}" ]]; then
    wait "${DEV_PID}" 2>/dev/null
  fi

  if ! npm run db:stop; then
    warn "database cleanup failed"
  fi

  if [[ -f "${PID_FILE}" ]]; then
    recorded_pid="$(<"${PID_FILE}")"
  fi

  if [[ "${recorded_pid}" == "$$" ]]; then
    rm -f -- "${PID_FILE}"
  fi

  exit "${exit_status}"
}

wait_for_database() {
  local elapsed_seconds=0
  local health_status=""

  while ((elapsed_seconds < HEALTH_TIMEOUT)); do
    health_status="$(
      docker inspect --format '{{.State.Health.Status}}' mercury-postgres 2>/dev/null || true
    )"

    case "${health_status}" in
      healthy)
        return 0
        ;;
      unhealthy)
        die "mercury-postgres is unhealthy"
        ;;
    esac

    sleep 1
    ((elapsed_seconds += 1))
  done

  die "timed out waiting for mercury-postgres to become healthy"
}

main() {
  local dev_status

  cd -- "${ROOT_DIR}"
  validate_environment

  mkdir -p -- "${STATE_DIR}"
  trap 'cleanup "$?"' EXIT
  trap 'cleanup 130' INT
  trap 'cleanup 143' TERM
  printf '%s\n' "$$" >"${PID_FILE}"

  log "Stopping database"
  npm run db:stop

  log "Starting database"
  npm run db:start

  log "Waiting for database health"
  wait_for_database

  log "Starting development services"
  npm run dev <&0 &
  DEV_PID=$!

  set +e
  wait "${DEV_PID}"
  dev_status=$?
  set -e

  cleanup "${dev_status}"
}

main "$@"
