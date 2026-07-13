#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CANONICAL_RESTART_SCRIPT="${ROOT_DIR}/restart.sh"

if [[ "${BASH_SOURCE[0]}" != "${CANONICAL_RESTART_SCRIPT}" ]]; then
  export MERCURY_RESTART_CANONICAL_PATH="${CANONICAL_RESTART_SCRIPT}"
  exec "${CANONICAL_RESTART_SCRIPT}" "$@"
fi

STATE_DIR="${MERCURY_RESTART_STATE_DIR:-${ROOT_DIR}/.nx}"
PID_FILE="${STATE_DIR}/mercury-restart.pid"
HEALTH_TIMEOUT="${MERCURY_RESTART_HEALTH_TIMEOUT:-60}"
SHUTDOWN_TIMEOUT="${MERCURY_RESTART_SHUTDOWN_TIMEOUT:-10}"
WEB_PORT="${MERCURY_WEB_PORT:-18123}"
WEB_URL="http://localhost:${WEB_PORT}"
WEB_HEALTH_URL="${WEB_URL}/api/trpc/healthCheck?batch=1&input=%7B%7D"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/mercury}"
XHS_ARTIFACT_DIR="${XHS_ARTIFACT_DIR:-${ROOT_DIR}/.data/xhs-artifacts}"
XHS_PROFILE_DIR="${XHS_PROFILE_DIR:-${ROOT_DIR}/.data/xhs-profile}"
XHS_PROVIDER="${XHS_PROVIDER:-playwright}"
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
  [[ "${SHUTDOWN_TIMEOUT}" =~ ^[1-9][0-9]*$ ]] ||
    die "MERCURY_RESTART_SHUTDOWN_TIMEOUT must be a positive integer"
  [[ "${WEB_PORT}" =~ ^[1-9][0-9]{0,4}$ ]] && ((10#${WEB_PORT} <= 65535)) ||
    die "MERCURY_WEB_PORT must be an integer between 1 and 65535"

  for command_name in npm curl docker lsof pgrep ps; do
    require_command "${command_name}"
  done

  docker info >/dev/null 2>&1 || die "Docker is not reachable"
}

process_is_running() {
  local process_pid="$1"
  local process_state=""

  kill -0 "${process_pid}" 2>/dev/null || return 1
  process_state="$(ps -p "${process_pid}" -o state= 2>/dev/null || true)"
  [[ -n "${process_state}" ]] && [[ "${process_state}" != *Z* ]]
}

stop_previous_session() {
  local elapsed_seconds=0
  local previous_command=""
  local previous_pid=""

  [[ -f "${PID_FILE}" ]] || return 0

  previous_pid="$(<"${PID_FILE}")"
  if [[ ! "${previous_pid}" =~ ^[1-9][0-9]*$ ]]; then
    warn "removing malformed restart PID file: ${PID_FILE}"
    rm -f -- "${PID_FILE}"
    return 0
  fi

  if ! process_is_running "${previous_pid}"; then
    rm -f -- "${PID_FILE}"
    return
  fi

  previous_command="$(ps -p "${previous_pid}" -o command= 2>/dev/null || true)"
  case " ${previous_command} " in
    *" ${CANONICAL_RESTART_SCRIPT} "*)
      ;;
    *)
      die "PID ${previous_pid} is not running ${CANONICAL_RESTART_SCRIPT}; refusing to signal it (remove ${PID_FILE} if stale)"
      ;;
  esac

  log "Stopping previous restart session (PID ${previous_pid})"
  kill -TERM "${previous_pid}" 2>/dev/null || true

  while ((elapsed_seconds < SHUTDOWN_TIMEOUT)); do
    if ! process_is_running "${previous_pid}"; then
      rm -f -- "${PID_FILE}"
      return
    fi

    sleep 1
    ((elapsed_seconds += 1))
  done

  die "previous restart session PID ${previous_pid} did not exit within ${SHUTDOWN_TIMEOUT} seconds; stop it manually or increase MERCURY_RESTART_SHUTDOWN_TIMEOUT (KILL was not sent)"
}

assert_port_available() {
  local listener_pids=""
  local port="$1"

  listener_pids="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "${listener_pids}" ]]; then
    listener_pids="${listener_pids//$'\n'/ }"
    die "Port ${port} is already in use by PID(s): ${listener_pids}"
  fi
}

terminate_process_tree() {
  local child_pid
  local child_pids=""
  local root_pid="$1"

  child_pids="$(pgrep -P "${root_pid}" 2>/dev/null || true)"
  for child_pid in ${child_pids}; do
    terminate_process_tree "${child_pid}"
  done

  if process_is_running "${root_pid}"; then
    kill -TERM "${root_pid}" 2>/dev/null || true
  fi
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

  if [[ -n "${DEV_PID}" ]] && process_is_running "${DEV_PID}"; then
    terminate_process_tree "${DEV_PID}"
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

prepare_runtime_environment() {
  export DATABASE_URL
  export MERCURY_WEB_PORT="${WEB_PORT}"
  export XHS_ARTIFACT_DIR
  export XHS_PROFILE_DIR
  export XHS_PROVIDER
}

wait_for_http_service() {
  local elapsed_seconds=0
  local service_name="$1"
  local service_url="$2"

  while ((elapsed_seconds < HEALTH_TIMEOUT)); do
    if curl --fail --silent --output /dev/null --max-time 1 "${service_url}"; then
      return 0
    fi

    process_is_running "${DEV_PID}" ||
      die "development service exited while waiting for ${service_name}"

    sleep 1
    ((elapsed_seconds += 1))
  done

  die "timed out waiting for ${service_name} at ${service_url}"
}

print_service_summary() {
  printf '\n'
  log "Xiaohongshu publisher is ready"
  log "  Web:      ${WEB_URL}"
  log "  Database: localhost:5432 (mercury)"
  log "Press Ctrl+C to stop the managed services"
  printf '\n'
}

main() {
  local dev_status

  cd -- "${ROOT_DIR}"
  validate_environment

  mkdir -p -- "${STATE_DIR}"
  stop_previous_session
  assert_port_available "${WEB_PORT}"
  prepare_runtime_environment
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

  log "Applying database migrations"
  npm run db:migrate

  log "Starting Xiaohongshu publisher"
  npm run dev <&0 &
  DEV_PID=$!

  log "Waiting for Web application health"
  wait_for_http_service "Web application" "${WEB_HEALTH_URL}"
  print_service_summary

  set +e
  wait "${DEV_PID}"
  dev_status=$?
  set -e

  cleanup "${dev_status}"
}

main "$@"
