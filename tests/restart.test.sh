#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_RESTART_SCRIPT="${ROOT_DIR}/restart.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mercury-restart-test.XXXXXX")"
FIXTURE_DIR="${TEST_DIR}/project"
RESTART_SCRIPT="${FIXTURE_DIR}/restart.sh"
SHIM_DIR="${TEST_DIR}/bin"
STATE_DIR="${FIXTURE_DIR}/.nx"
LOG_FILE="${TEST_DIR}/commands.log"
OUTPUT_FILE="${TEST_DIR}/restart.out"
DEV_PID_FILE="${TEST_DIR}/dev.pid"
DB_STOP_COUNT_FILE="${TEST_DIR}/db-stop-count"
CLEANUP_GATE_FILE="${TEST_DIR}/cleanup-release"
CLEANUP_PID_FILE="${TEST_DIR}/cleanup.pid"
STDIN_FILE="${TEST_DIR}/supervisor.stdin"
EXPECTED_STDIN_BYTE="x"
SUPERVISOR_PID=""

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

wait_for_process_exit() {
  local process_pid="$1"
  local attempt
  local max_attempts=100

  for ((attempt = 0; attempt < max_attempts; attempt += 1)); do
    if ! kill -0 "${process_pid}" 2>/dev/null; then
      return 0
    fi

    sleep 0.05
  done

  return 1
}

cleanup_test_environment() {
  local cleanup_pid=""
  local dev_pid=""

  set +e
  : >"${CLEANUP_GATE_FILE}"

  if [[ -n "${SUPERVISOR_PID}" ]] && kill -0 "${SUPERVISOR_PID}" 2>/dev/null; then
    kill -TERM "${SUPERVISOR_PID}" 2>/dev/null
    if ! wait_for_process_exit "${SUPERVISOR_PID}"; then
      kill -KILL "${SUPERVISOR_PID}" 2>/dev/null
    fi
    wait "${SUPERVISOR_PID}" 2>/dev/null
  fi

  if [[ -f "${DEV_PID_FILE}" ]]; then
    dev_pid="$(<"${DEV_PID_FILE}")"
    if [[ -n "${dev_pid}" ]] && kill -0 "${dev_pid}" 2>/dev/null; then
      kill -TERM "${dev_pid}" 2>/dev/null
      if ! wait_for_process_exit "${dev_pid}"; then
        kill -KILL "${dev_pid}" 2>/dev/null
      fi
    fi
  fi

  if [[ -f "${CLEANUP_PID_FILE}" ]]; then
    cleanup_pid="$(<"${CLEANUP_PID_FILE}")"
    if [[ -n "${cleanup_pid}" ]] && kill -0 "${cleanup_pid}" 2>/dev/null; then
      if ! wait_for_process_exit "${cleanup_pid}"; then
        kill -KILL "${cleanup_pid}" 2>/dev/null
      fi
    fi
  fi

  rm -rf -- "${TEST_DIR}"
}

trap cleanup_test_environment EXIT

[[ -x "${SOURCE_RESTART_SCRIPT}" ]] || fail "restart.sh must exist and be executable"

mkdir -p -- "${SHIM_DIR}" "${FIXTURE_DIR}/apps/web" "${FIXTURE_DIR}/apps/native"
cp -- "${SOURCE_RESTART_SCRIPT}" "${RESTART_SCRIPT}"
chmod +x "${RESTART_SCRIPT}"
: >"${FIXTURE_DIR}/apps/web/.env"
: >"${FIXTURE_DIR}/apps/native/.env"
: >"${LOG_FILE}"
printf '%s' "${EXPECTED_STDIN_BYTE}" >"${STDIN_FILE}"

cat >"${SHIM_DIR}/npm" <<'SHIM'
#!/usr/bin/env bash

set -Eeuo pipefail

printf 'npm %s\n' "$*" >>"${MERCURY_TEST_LOG}"

if [[ "$*" == "run db:stop" ]]; then
  DB_STOP_COUNT=0

  if [[ -f "${MERCURY_TEST_DB_STOP_COUNT_FILE}" ]]; then
    DB_STOP_COUNT="$(<"${MERCURY_TEST_DB_STOP_COUNT_FILE}")"
  fi

  ((DB_STOP_COUNT += 1))
  printf '%s\n' "${DB_STOP_COUNT}" >"${MERCURY_TEST_DB_STOP_COUNT_FILE}"

  if ((DB_STOP_COUNT == 2)); then
    printf '%s\n' "$$" >"${MERCURY_TEST_CLEANUP_PID_FILE}"
    printf '%s\n' "cleanup db:stop entered" >>"${MERCURY_TEST_LOG}"

    for ((attempt = 0; attempt < 100; attempt += 1)); do
      if [[ -e "${MERCURY_TEST_CLEANUP_GATE_FILE}" ]]; then
        exit 0
      fi

      sleep 0.05
    done

    printf '%s\n' "cleanup db:stop timed out" >>"${MERCURY_TEST_LOG}"
    exit 1
  fi
fi

if [[ "$*" == "run dev" ]]; then
  DEV_STDIN_BYTE=""
  SLEEP_PID=""

  stop_dev() {
    trap - INT TERM

    if [[ -n "${SLEEP_PID}" ]] && kill -0 "${SLEEP_PID}" 2>/dev/null; then
      kill -TERM "${SLEEP_PID}" 2>/dev/null
      wait "${SLEEP_PID}" 2>/dev/null || true
    fi

    printf '%s\n' "dev received TERM" >>"${MERCURY_TEST_LOG}"
    exit 0
  }

  trap stop_dev INT TERM
  printf '%s\n' "$$" >"${MERCURY_TEST_DEV_PID_FILE}"

  if IFS= read -r -n 1 DEV_STDIN_BYTE; then
    printf 'dev stdin %s\n' "${DEV_STDIN_BYTE}" >>"${MERCURY_TEST_LOG}"
  else
    printf '%s\n' "dev stdin <empty>" >>"${MERCURY_TEST_LOG}"
  fi

  printf '%s\n' "dev stdout marker"
  printf '%s\n' "dev stderr marker" >&2
  printf '%s\n' "dev ready" >>"${MERCURY_TEST_LOG}"

  while true; do
    sleep 1 &
    SLEEP_PID=$!
    wait "${SLEEP_PID}" || true
    SLEEP_PID=""
  done
fi
SHIM

cat >"${SHIM_DIR}/docker" <<'SHIM'
#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "${1:-}" == "info" ]]; then
  exit 0
fi

if [[ "${1:-}" == "inspect" ]] &&
  [[ "${2:-}" == "--format" ]] &&
  [[ "${3:-}" == "{{.State.Health.Status}}" ]] &&
  [[ "${4:-}" == "mercury-postgres" ]]; then
  printf '%s\n' "docker inspect mercury-postgres healthy" >>"${MERCURY_TEST_LOG}"
  printf '%s\n' "healthy"
  exit 0
fi

exit 1
SHIM

cat >"${SHIM_DIR}/bun" <<'SHIM'
#!/usr/bin/env bash

exit 0
SHIM

cat >"${SHIM_DIR}/lsof" <<'SHIM'
#!/usr/bin/env bash

exit 1
SHIM

chmod +x "${SHIM_DIR}/npm" "${SHIM_DIR}/docker" "${SHIM_DIR}/bun" "${SHIM_DIR}/lsof"

wait_for_log_line() {
  local expected_line="$1"
  local attempt
  local max_attempts=100

  for ((attempt = 0; attempt < max_attempts; attempt += 1)); do
    if grep -Fqx -- "${expected_line}" "${LOG_FILE}" 2>/dev/null; then
      return 0
    fi

    if [[ -n "${SUPERVISOR_PID}" ]] && ! kill -0 "${SUPERVISOR_PID}" 2>/dev/null; then
      return 1
    fi

    sleep 0.05
  done

  return 1
}

count_log_line() {
  local expected_line="$1"
  local count

  count="$(grep -Fxc -- "${expected_line}" "${LOG_FILE}" 2>/dev/null || true)"
  printf '%s\n' "${count:-0}"
}

assert_count() {
  local expected_count="$1"
  local expected_line="$2"
  local actual_count

  actual_count="$(count_log_line "${expected_line}")"
  [[ "${actual_count}" == "${expected_count}" ]] ||
    fail "expected ${expected_count} '${expected_line}' calls, got ${actual_count}"
}

(
  cd -- "${TEST_DIR}"
  exec env \
    PATH="${SHIM_DIR}:${PATH}" \
    MERCURY_TEST_LOG="${LOG_FILE}" \
    MERCURY_TEST_DEV_PID_FILE="${DEV_PID_FILE}" \
    MERCURY_TEST_DB_STOP_COUNT_FILE="${DB_STOP_COUNT_FILE}" \
    MERCURY_TEST_CLEANUP_GATE_FILE="${CLEANUP_GATE_FILE}" \
    MERCURY_TEST_CLEANUP_PID_FILE="${CLEANUP_PID_FILE}" \
    MERCURY_RESTART_STATE_DIR="${STATE_DIR}" \
    MERCURY_RESTART_HEALTH_TIMEOUT=2 \
    "${RESTART_SCRIPT}"
) <"${STDIN_FILE}" >"${OUTPUT_FILE}" 2>&1 &
SUPERVISOR_PID=$!

wait_for_log_line "dev ready" || fail "development process did not become ready"

dev_stdin_line="$(grep -F "dev stdin " "${LOG_FILE}" | tail -n 1 || true)"
actual_stdin_byte="${dev_stdin_line#dev stdin }"
[[ "${actual_stdin_byte}" == "${EXPECTED_STDIN_BYTE}" ]] ||
  fail "expected dev stdin byte '${EXPECTED_STDIN_BYTE}', got '${actual_stdin_byte:-<missing>}'"

kill -TERM "${SUPERVISOR_PID}"
wait_for_log_line "cleanup db:stop entered" || fail "cleanup did not reach delayed db:stop"
kill -TERM "${SUPERVISOR_PID}" || fail "supervisor exited before repeated TERM"
: >"${CLEANUP_GATE_FILE}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "supervisor did not stop after TERM"
set +e
wait "${SUPERVISOR_PID}"
supervisor_status=$?
set -e
SUPERVISOR_PID=""

dev_pid="$(<"${DEV_PID_FILE}")"
cleanup_pid="$(<"${CLEANUP_PID_FILE}")"
wait_for_process_exit "${dev_pid}" || fail "development shim did not stop"
wait_for_process_exit "${cleanup_pid}" || fail "cleanup shim did not stop"

[[ "${supervisor_status}" == "143" ]] ||
  fail "expected supervisor exit status 143, got ${supervisor_status}"

assert_count 1 "npm run db:start"
assert_count 1 "npm run dev"
assert_count 1 "dev received TERM"
assert_count 2 "npm run db:stop"
assert_count 1 "docker inspect mercury-postgres healthy"

db_start_line="$(grep -nFx -- "npm run db:start" "${LOG_FILE}" | cut -d: -f1)"
health_inspection_line="$(
  grep -nFx -- "docker inspect mercury-postgres healthy" "${LOG_FILE}" | cut -d: -f1
)"
dev_start_line="$(grep -nFx -- "npm run dev" "${LOG_FILE}" | cut -d: -f1)"
((db_start_line < health_inspection_line)) || fail "database must start before health inspection"
((health_inspection_line < dev_start_line)) || fail "database must be healthy before development services"

grep -Fqx -- "dev stdout marker" "${OUTPUT_FILE}" || fail "development stdout was not inherited"
grep -Fqx -- "dev stderr marker" "${OUTPUT_FILE}" || fail "development stderr was not inherited"

[[ ! -e "${STATE_DIR}/mercury-restart.pid" ]] || fail "PID state was not removed after repeated TERM"

printf '%s\n' "PASS: foreground lifecycle"
