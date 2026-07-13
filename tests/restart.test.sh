#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_RESTART_SCRIPT="${ROOT_DIR}/restart.sh"
ROOT_PACKAGE_JSON="${ROOT_DIR}/package.json"
WEB_PACKAGE_JSON="${ROOT_DIR}/apps/web/package.json"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mercury-restart-test.XXXXXX")"
TEST_DIR="$(cd -- "${TEST_DIR}" && pwd)"
FIXTURE_DIR="${TEST_DIR}/project"
RESTART_SCRIPT="${FIXTURE_DIR}/restart.sh"
SHIM_DIR="${TEST_DIR}/bin"
STATE_DIR="${FIXTURE_DIR}/.nx"
LOG_FILE="${TEST_DIR}/commands.log"
OUTPUT_FILE="${TEST_DIR}/restart.out"
REPLACEMENT_OUTPUT_FILE="${TEST_DIR}/replacement.out"
DEV_PID_FILE="${TEST_DIR}/dev.pid"
DEV_DESCENDANT_PID_FILE="${TEST_DIR}/dev-descendant.pid"
DB_STOP_COUNT_FILE="${TEST_DIR}/db-stop-count"
CLEANUP_GATE_FILE="${TEST_DIR}/cleanup-release"
CLEANUP_PID_FILE="${TEST_DIR}/cleanup.pid"
STDIN_FILE="${TEST_DIR}/supervisor.stdin"
EXPECTED_STDIN_BYTE="x"
SUPERVISOR_PID=""
REPLACEMENT_PID=""
LAUNCHED_SUPERVISOR_PID=""
AUXILIARY_PID=""
OCCUPIED_PORT=""
PORT_OWNER_PID=""
DEV_DESCENDANT_MODE=""
WEB_PORT=""

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

process_is_running() {
  local process_pid="$1"
  local process_state=""

  kill -0 "${process_pid}" 2>/dev/null || return 1
  process_state="$(ps -p "${process_pid}" -o state= 2>/dev/null || true)"
  [[ -n "${process_state}" ]] && [[ "${process_state}" != *Z* ]]
}

wait_for_process_exit() {
  local process_pid="$1"
  local attempt
  local max_attempts=100

  for ((attempt = 0; attempt < max_attempts; attempt += 1)); do
    if ! process_is_running "${process_pid}"; then
      return 0
    fi

    sleep 0.05
  done

  return 1
}

stop_test_process() {
  local process_pid="$1"

  if [[ -z "${process_pid}" ]] || ! process_is_running "${process_pid}"; then
    return
  fi

  kill -TERM "${process_pid}" 2>/dev/null
  if ! wait_for_process_exit "${process_pid}"; then
    kill -KILL "${process_pid}" 2>/dev/null
  fi
  wait "${process_pid}" 2>/dev/null || true
}

cleanup_test_environment() {
  local cleanup_pid=""
  local descendant_pid=""
  local dev_pid=""

  set +e
  : >"${CLEANUP_GATE_FILE}"

  stop_test_process "${REPLACEMENT_PID}"
  stop_test_process "${SUPERVISOR_PID}"
  stop_test_process "${AUXILIARY_PID}"

  if [[ -f "${DEV_DESCENDANT_PID_FILE}" ]]; then
    descendant_pid="$(<"${DEV_DESCENDANT_PID_FILE}")"
    stop_test_process "${descendant_pid}"
  fi

  if [[ -f "${DEV_PID_FILE}" ]]; then
    dev_pid="$(<"${DEV_PID_FILE}")"
    stop_test_process "${dev_pid}"
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
grep -Fq -- \
  '"dev": "nx run-many -t dev --projects=web --outputStyle=stream"' \
  "${ROOT_PACKAGE_JSON}" || fail "root dev script must stream only the Web project"
grep -Fq -- 'next dev --hostname 0.0.0.0 --port ${MERCURY_WEB_PORT:-18123}' "${WEB_PACKAGE_JSON}" ||
  fail "web dev script must honor MERCURY_WEB_PORT"

mkdir -p -- "${SHIM_DIR}" "${FIXTURE_DIR}"
cp -- "${SOURCE_RESTART_SCRIPT}" "${RESTART_SCRIPT}"
chmod +x "${RESTART_SCRIPT}"
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
        printf '%s\n' "cleanup db:stop finished" >>"${MERCURY_TEST_LOG}"
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

  if [[ "${MERCURY_TEST_DEV_DESCENDANT_MODE:-}" == "record-term" ]]; then
    bash -c '
      set -Eeuo pipefail
      DESCENDANT_SLEEP_PID=""

      stop_descendant() {
        trap - INT TERM
        if [[ -n "${DESCENDANT_SLEEP_PID}" ]] && kill -0 "${DESCENDANT_SLEEP_PID}" 2>/dev/null; then
          kill -TERM "${DESCENDANT_SLEEP_PID}" 2>/dev/null
          wait "${DESCENDANT_SLEEP_PID}" 2>/dev/null || true
        fi
        printf "%s\n" "dev descendant received TERM" >>"${MERCURY_TEST_LOG}"
        exit 0
      }

      trap stop_descendant INT TERM
      printf "%s\n" "$$" >"${MERCURY_TEST_DEV_DESCENDANT_PID_FILE}"
      printf "%s\n" "dev descendant ready" >>"${MERCURY_TEST_LOG}"

      while true; do
        sleep 1 &
        DESCENDANT_SLEEP_PID=$!
        wait "${DESCENDANT_SLEEP_PID}" || true
        DESCENDANT_SLEEP_PID=""
      done
    ' &
  fi

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
  printf 'dev web port %s\n' "${MERCURY_WEB_PORT:-<missing>}" >>"${MERCURY_TEST_LOG}"
  printf 'dev database url %s\n' "${DATABASE_URL:-<missing>}" >>"${MERCURY_TEST_LOG}"
  printf 'dev xhs artifact dir %s\n' "${XHS_ARTIFACT_DIR:-<missing>}" >>"${MERCURY_TEST_LOG}"
  printf 'dev xhs profile dir %s\n' "${XHS_PROFILE_DIR:-<missing>}" >>"${MERCURY_TEST_LOG}"
  printf 'dev xhs provider %s\n' "${XHS_PROVIDER:-<missing>}" >>"${MERCURY_TEST_LOG}"
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

cat >"${SHIM_DIR}/curl" <<'SHIM'
#!/usr/bin/env bash

set -Eeuo pipefail

printf 'curl %s\n' "$*" >>"${MERCURY_TEST_LOG}"

REQUEST_URL="${!#}"
EXPECTED_WEB_HEALTH_URL="http://localhost:${MERCURY_WEB_PORT:-18123}/api/trpc/healthCheck?batch=1&input=%7B%7D"

if [[ "${REQUEST_URL}" == "${EXPECTED_WEB_HEALTH_URL}" ]]; then
  exit 0
fi

exit 1
SHIM

cat >"${SHIM_DIR}/lsof" <<'SHIM'
#!/usr/bin/env bash

set -Eeuo pipefail

printf 'lsof %s\n' "$*" >>"${MERCURY_TEST_LOG}"

if [[ -n "${MERCURY_TEST_OCCUPIED_PORT:-}" ]] &&
  [[ "$*" == "-nP -iTCP:${MERCURY_TEST_OCCUPIED_PORT} -sTCP:LISTEN -t" ]]; then
  printf '%s\n' "${MERCURY_TEST_PORT_OWNER_PID}"
  exit 0
fi

exit 1
SHIM

chmod +x \
  "${SHIM_DIR}/npm" \
  "${SHIM_DIR}/docker" \
  "${SHIM_DIR}/curl" \
  "${SHIM_DIR}/lsof"

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

wait_for_output_text() {
  local expected_text="$1"
  local output_file="${2:-${OUTPUT_FILE}}"
  local attempt
  local max_attempts=100

  for ((attempt = 0; attempt < max_attempts; attempt += 1)); do
    if grep -Fq -- "${expected_text}" "${output_file}" 2>/dev/null; then
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

wait_for_log_count() {
  local expected_count="$1"
  local expected_line="$2"
  local attempt
  local max_attempts=100

  for ((attempt = 0; attempt < max_attempts; attempt += 1)); do
    if (("$(count_log_line "${expected_line}")" >= expected_count)); then
      return 0
    fi

    sleep 0.05
  done

  return 1
}

assert_count() {
  local expected_count="$1"
  local expected_line="$2"
  local actual_count

  actual_count="$(count_log_line "${expected_line}")"
  [[ "${actual_count}" == "${expected_count}" ]] ||
    fail "expected ${expected_count} '${expected_line}' calls, got ${actual_count}"
}

launch_supervisor() {
  local output_file="$1"
  local shutdown_timeout="${2:-3}"

  (
    cd -- "${FIXTURE_DIR}"
    exec env \
      PATH="${SHIM_DIR}:${PATH}" \
      MERCURY_TEST_LOG="${LOG_FILE}" \
      MERCURY_TEST_DEV_PID_FILE="${DEV_PID_FILE}" \
      MERCURY_TEST_DEV_DESCENDANT_PID_FILE="${DEV_DESCENDANT_PID_FILE}" \
      MERCURY_TEST_DEV_DESCENDANT_MODE="${DEV_DESCENDANT_MODE}" \
      MERCURY_TEST_DB_STOP_COUNT_FILE="${DB_STOP_COUNT_FILE}" \
      MERCURY_TEST_CLEANUP_GATE_FILE="${CLEANUP_GATE_FILE}" \
      MERCURY_TEST_CLEANUP_PID_FILE="${CLEANUP_PID_FILE}" \
      MERCURY_TEST_OCCUPIED_PORT="${OCCUPIED_PORT}" \
      MERCURY_TEST_PORT_OWNER_PID="${PORT_OWNER_PID}" \
      MERCURY_RESTART_STATE_DIR="${STATE_DIR}" \
      MERCURY_RESTART_HEALTH_TIMEOUT=2 \
      MERCURY_RESTART_SHUTDOWN_TIMEOUT="${shutdown_timeout}" \
			MERCURY_WEB_PORT="${WEB_PORT}" \
      ./restart.sh
  ) <"${STDIN_FILE}" >"${output_file}" 2>&1 &
  LAUNCHED_SUPERVISOR_PID=$!
}

reset_case_files() {
  : >"${LOG_FILE}"
  : >"${OUTPUT_FILE}"
  : >"${REPLACEMENT_OUTPUT_FILE}"
  rm -f -- \
    "${DB_STOP_COUNT_FILE}" \
    "${CLEANUP_GATE_FILE}" \
    "${CLEANUP_PID_FILE}" \
    "${DEV_DESCENDANT_PID_FILE}" \
    "${DEV_PID_FILE}" \
    "${STATE_DIR}/mercury-restart.pid"
}

launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"

wait_for_log_line "dev ready" || fail "development process did not become ready"
wait_for_output_text "Xiaohongshu publisher is ready" ||
  fail "publisher did not print its ready summary"

supervisor_command="$(ps -p "${SUPERVISOR_PID}" -o command=)"
[[ "${supervisor_command}" == *"${RESTART_SCRIPT}"* ]] ||
  fail "relative launch did not canonicalize supervisor command: ${supervisor_command}"

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
assert_count 1 "npm run db:migrate"
assert_count 1 "npm run dev"
assert_count 1 "dev received TERM"
assert_count 2 "npm run db:stop"
assert_count 1 "docker inspect mercury-postgres healthy"
assert_count 1 \
  "dev database url postgresql://postgres:password@localhost:5432/mercury"
assert_count 1 "dev xhs artifact dir ${FIXTURE_DIR}/.data/xhs-artifacts"
assert_count 1 "dev xhs profile dir ${FIXTURE_DIR}/.data/xhs-profile"
assert_count 1 "dev xhs provider playwright"

db_start_line="$(grep -nFx -- "npm run db:start" "${LOG_FILE}" | cut -d: -f1)"
health_inspection_line="$(
  grep -nFx -- "docker inspect mercury-postgres healthy" "${LOG_FILE}" | cut -d: -f1
)"
migration_line="$(grep -nFx -- "npm run db:migrate" "${LOG_FILE}" | cut -d: -f1)"
dev_start_line="$(grep -nFx -- "npm run dev" "${LOG_FILE}" | cut -d: -f1)"
((db_start_line < health_inspection_line)) || fail "database must start before health inspection"
((health_inspection_line < migration_line)) || fail "database must be healthy before migrations"
((migration_line < dev_start_line)) || fail "migrations must finish before development services"

grep -Fqx -- "dev stdout marker" "${OUTPUT_FILE}" || fail "development stdout was not inherited"
grep -Fqx -- "dev stderr marker" "${OUTPUT_FILE}" || fail "development stderr was not inherited"
grep -Fq -- "Xiaohongshu publisher is ready" "${OUTPUT_FILE}" ||
  fail "ready summary was not printed"
grep -Fq -- "Web:      http://localhost:18123" "${OUTPUT_FILE}" ||
  fail "ready summary did not include the Web link"
assert_count 1 \
  "curl --fail --silent --output /dev/null --max-time 1 http://localhost:18123/api/trpc/healthCheck?batch=1&input=%7B%7D"

[[ ! -e "${STATE_DIR}/mercury-restart.pid" ]] || fail "PID state was not removed after repeated TERM"

printf '%s\n' "PASS: foreground lifecycle"

reset_case_files

launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "dev ready" || fail "first managed development process did not become ready"
first_dev_pid="$(<"${DEV_PID_FILE}")"

launch_supervisor "${REPLACEMENT_OUTPUT_FILE}"
REPLACEMENT_PID="${LAUNCHED_SUPERVISOR_PID}"

wait_for_log_count 1 "dev received TERM" ||
  fail "prior development process did not receive TERM"
wait_for_log_count 1 "cleanup db:stop entered" ||
  fail "prior supervisor did not enter database cleanup"

assert_count 1 "npm run db:start"
assert_count 1 "npm run db:migrate"
assert_count 1 "npm run dev"
assert_count 1 "lsof -nP -iTCP:18123 -sTCP:LISTEN -t"
[[ ! -e "${CLEANUP_GATE_FILE}" ]] || fail "managed cleanup gate was released early"

: >"${CLEANUP_GATE_FILE}"
wait_for_log_count 1 "cleanup db:stop finished" ||
  fail "prior database cleanup did not finish"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "prior supervisor did not exit"

set +e
wait "${SUPERVISOR_PID}"
prior_supervisor_status=$?
set -e
SUPERVISOR_PID=""

wait_for_log_count 2 "dev ready" || fail "replacement development process did not become ready"
second_dev_pid="$(<"${DEV_PID_FILE}")"

kill -TERM "${REPLACEMENT_PID}"
wait_for_process_exit "${REPLACEMENT_PID}" || fail "replacement supervisor did not exit"
set +e
wait "${REPLACEMENT_PID}"
replacement_status=$?
set -e
REPLACEMENT_PID=""

wait_for_process_exit "${first_dev_pid}" || fail "prior development process leaked"
wait_for_process_exit "${second_dev_pid}" || fail "replacement development process leaked"

[[ "${prior_supervisor_status}" == "143" ]] ||
  fail "expected prior supervisor exit status 143, got ${prior_supervisor_status}"
[[ "${replacement_status}" == "143" ]] ||
  fail "expected replacement supervisor exit status 143, got ${replacement_status}"

assert_count 2 "npm run db:start"
assert_count 2 "npm run db:migrate"
assert_count 2 "npm run dev"
assert_count 2 "dev received TERM"
assert_count 4 "npm run db:stop"
assert_count 2 "lsof -nP -iTCP:18123 -sTCP:LISTEN -t"

cleanup_finished_line="$(
  grep -nFx -- "cleanup db:stop finished" "${LOG_FILE}" | head -n 1 | cut -d: -f1
)"
replacement_db_start_line="$(
  grep -nFx -- "npm run db:start" "${LOG_FILE}" | sed -n '2p' | cut -d: -f1
)"
replacement_dev_start_line="$(
  grep -nFx -- "npm run dev" "${LOG_FILE}" | sed -n '2p' | cut -d: -f1
)"
replacement_port_18123_line="$(
  grep -nFx -- "lsof -nP -iTCP:18123 -sTCP:LISTEN -t" "${LOG_FILE}" |
    sed -n '2p' |
    cut -d: -f1
)"
((cleanup_finished_line < replacement_port_18123_line)) ||
  fail "replacement probed port 18123 before prior cleanup finished"
((replacement_port_18123_line < replacement_db_start_line)) ||
  fail "replacement database started before port 18123 was checked"
((cleanup_finished_line < replacement_db_start_line)) ||
  fail "replacement database started before prior cleanup finished"
((cleanup_finished_line < replacement_dev_start_line)) ||
  fail "replacement development process started before prior cleanup finished"

[[ ! -e "${STATE_DIR}/mercury-restart.pid" ]] ||
  fail "replacement PID state was not removed"

printf '%s\n' "PASS: managed replacement"

reset_case_files
mkdir -p -- "${STATE_DIR}"
printf '%s\n' "not-a-pid" >"${STATE_DIR}/mercury-restart.pid"

launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "dev ready" || fail "malformed PID state prevented startup"

grep -Fq -- "warning:" "${OUTPUT_FILE}" ||
  fail "malformed PID state did not emit a warning"
[[ "$(<"${STATE_DIR}/mercury-restart.pid")" == "${SUPERVISOR_PID}" ]] ||
  fail "malformed PID state was not replaced"

: >"${CLEANUP_GATE_FILE}"
kill -TERM "${SUPERVISOR_PID}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "malformed-state supervisor did not exit"
set +e
wait "${SUPERVISOR_PID}"
malformed_state_status=$?
set -e
SUPERVISOR_PID=""
[[ "${malformed_state_status}" == "143" ]] ||
  fail "expected malformed-state supervisor status 143, got ${malformed_state_status}"

reset_case_files
mkdir -p -- "${STATE_DIR}"
dead_pid=99999999
process_is_running "${dead_pid}" && fail "chosen stale PID is unexpectedly live"
printf '%s\n' "${dead_pid}" >"${STATE_DIR}/mercury-restart.pid"

launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "dev ready" || fail "dead PID state prevented startup"
[[ "$(<"${STATE_DIR}/mercury-restart.pid")" == "${SUPERVISOR_PID}" ]] ||
  fail "dead PID state was not replaced"

: >"${CLEANUP_GATE_FILE}"
kill -TERM "${SUPERVISOR_PID}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "dead-state supervisor did not exit"
set +e
wait "${SUPERVISOR_PID}"
dead_state_status=$?
set -e
SUPERVISOR_PID=""
[[ "${dead_state_status}" == "143" ]] ||
  fail "expected dead-state supervisor status 143, got ${dead_state_status}"
[[ ! -e "${STATE_DIR}/mercury-restart.pid" ]] || fail "stale PID state was not removed"

printf '%s\n' "PASS: stale PID recovery"

reset_case_files
mkdir -p -- "${STATE_DIR}"
sleep 30 &
AUXILIARY_PID=$!
printf '%s\n' "${AUXILIARY_PID}" >"${STATE_DIR}/mercury-restart.pid"

launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "foreign-PID supervisor did not exit"
set +e
wait "${SUPERVISOR_PID}"
foreign_pid_status=$?
set -e
SUPERVISOR_PID=""

[[ "${foreign_pid_status}" != "0" ]] || fail "foreign PID state unexpectedly succeeded"
process_is_running "${AUXILIARY_PID}" || fail "foreign PID process was signaled"
grep -Fq -- "PID ${AUXILIARY_PID}" "${OUTPUT_FILE}" ||
  fail "foreign PID error did not identify the process"
grep -Fq -- "${RESTART_SCRIPT}" "${OUTPUT_FILE}" ||
  fail "foreign PID error did not identify the expected restart script"
grep -Fq -- "refusing to signal" "${OUTPUT_FILE}" ||
  fail "foreign PID error did not explain the safe action"
assert_count 0 "npm run db:stop"
assert_count 0 "npm run db:start"
assert_count 0 "npm run db:migrate"
assert_count 0 "npm run dev"
[[ "$(<"${STATE_DIR}/mercury-restart.pid")" == "${AUXILIARY_PID}" ]] ||
  fail "foreign PID state was overwritten"

stop_test_process "${AUXILIARY_PID}"
AUXILIARY_PID=""

printf '%s\n' "PASS: foreign PID safety"

reset_case_files
launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "dev ready" || fail "timeout-case development process did not become ready"
timeout_dev_pid="$(<"${DEV_PID_FILE}")"

launch_supervisor "${REPLACEMENT_OUTPUT_FILE}" 1
REPLACEMENT_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "cleanup db:stop entered" ||
  fail "timeout-case prior supervisor did not enter cleanup"
wait_for_process_exit "${REPLACEMENT_PID}" || fail "timed-out replacement did not exit"
set +e
wait "${REPLACEMENT_PID}"
timeout_replacement_status=$?
set -e
REPLACEMENT_PID=""

[[ "${timeout_replacement_status}" != "0" ]] || fail "timed-out replacement succeeded"
process_is_running "${SUPERVISOR_PID}" || fail "timed-out prior supervisor was killed"
wait_for_process_exit "${timeout_dev_pid}" || fail "timeout-case development process leaked"
grep -Fq -- "PID ${SUPERVISOR_PID}" "${REPLACEMENT_OUTPUT_FILE}" ||
  fail "shutdown timeout error did not identify the prior supervisor"
grep -Fq -- "MERCURY_RESTART_SHUTDOWN_TIMEOUT" "${REPLACEMENT_OUTPUT_FILE}" ||
  fail "shutdown timeout error did not explain how to adjust the bounded wait"
assert_count 2 "npm run db:stop"
assert_count 1 "npm run db:start"
assert_count 1 "npm run db:migrate"
assert_count 1 "npm run dev"

: >"${CLEANUP_GATE_FILE}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "timeout-case prior supervisor did not exit"
set +e
wait "${SUPERVISOR_PID}"
timeout_prior_status=$?
set -e
SUPERVISOR_PID=""
[[ "${timeout_prior_status}" == "143" ]] ||
  fail "expected timeout-case prior status 143, got ${timeout_prior_status}"
[[ ! -e "${STATE_DIR}/mercury-restart.pid" ]] ||
  fail "timeout-case prior PID state was not removed"

printf '%s\n' "PASS: bounded prior-session timeout"

test_occupied_port() {
  local occupied_port="$1"
  local port_status

  reset_case_files
  sleep 30 &
  AUXILIARY_PID=$!
  OCCUPIED_PORT="${occupied_port}"
  PORT_OWNER_PID="${AUXILIARY_PID}"

  launch_supervisor "${OUTPUT_FILE}"
  SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
  wait_for_log_count 1 "lsof -nP -iTCP:${occupied_port} -sTCP:LISTEN -t" ||
    fail "port ${occupied_port} was not probed"
  wait_for_process_exit "${SUPERVISOR_PID}" ||
    fail "occupied-port ${occupied_port} supervisor did not exit"
  set +e
  wait "${SUPERVISOR_PID}"
  port_status=$?
  set -e
  SUPERVISOR_PID=""

  [[ "${port_status}" != "0" ]] || fail "occupied port ${occupied_port} was accepted"
  process_is_running "${AUXILIARY_PID}" ||
    fail "owner of occupied port ${occupied_port} was signaled"
  grep -Fq -- \
    "Port ${occupied_port} is already in use by PID(s): ${AUXILIARY_PID}" \
    "${OUTPUT_FILE}" || fail "occupied port ${occupied_port} error was not actionable"
  assert_count 0 "npm run db:stop"
  assert_count 0 "npm run db:start"
  assert_count 0 "npm run db:migrate"
  assert_count 0 "npm run dev"
  assert_count 0 "lsof -nP -iTCP:5432 -sTCP:LISTEN -t"
  [[ ! -e "${STATE_DIR}/mercury-restart.pid" ]] ||
    fail "occupied port ${occupied_port} published supervisor PID state"

  stop_test_process "${AUXILIARY_PID}"
  AUXILIARY_PID=""
  OCCUPIED_PORT=""
  PORT_OWNER_PID=""

  printf 'PASS: occupied port %s safety\n' "${occupied_port}"
}

reset_case_files
sleep 30 &
AUXILIARY_PID=$!
OCCUPIED_PORT="18123"
PORT_OWNER_PID="${AUXILIARY_PID}"
WEB_PORT="18124"

launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "dev ready" || fail "custom-port development process did not become ready"
wait_for_output_text "Xiaohongshu publisher is ready" ||
  fail "custom-port publisher did not print its ready summary"

assert_count 0 "lsof -nP -iTCP:18123 -sTCP:LISTEN -t"
assert_count 1 "lsof -nP -iTCP:18124 -sTCP:LISTEN -t"
assert_count 1 "dev web port 18124"
assert_count 1 \
  "curl --fail --silent --output /dev/null --max-time 1 http://localhost:18124/api/trpc/healthCheck?batch=1&input=%7B%7D"
grep -Fq -- "Web:      http://localhost:18124" "${OUTPUT_FILE}" ||
  fail "custom-port ready summary did not include the Web link"
process_is_running "${AUXILIARY_PID}" || fail "custom port signaled port 18123 owner"

: >"${CLEANUP_GATE_FILE}"
kill -TERM "${SUPERVISOR_PID}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "custom-port supervisor did not exit"
set +e
wait "${SUPERVISOR_PID}"
custom_port_status=$?
set -e
SUPERVISOR_PID=""

[[ "${custom_port_status}" == "143" ]] ||
  fail "expected custom-port supervisor status 143, got ${custom_port_status}"

stop_test_process "${AUXILIARY_PID}"
AUXILIARY_PID=""
OCCUPIED_PORT=""
PORT_OWNER_PID=""
WEB_PORT=""

printf '%s\n' "PASS: custom web port"

test_occupied_port 18123

reset_case_files
DEV_DESCENDANT_MODE="record-term"
launch_supervisor "${OUTPUT_FILE}"
SUPERVISOR_PID="${LAUNCHED_SUPERVISOR_PID}"
wait_for_log_count 1 "dev descendant ready" || fail "development descendant did not become ready"
descendant_pid="$(<"${DEV_DESCENDANT_PID_FILE}")"

: >"${CLEANUP_GATE_FILE}"
kill -TERM "${SUPERVISOR_PID}"
wait_for_process_exit "${SUPERVISOR_PID}" || fail "descendant-case supervisor did not exit"
set +e
wait "${SUPERVISOR_PID}"
descendant_supervisor_status=$?
set -e
SUPERVISOR_PID=""

[[ "${descendant_supervisor_status}" == "143" ]] ||
  fail "expected descendant-case supervisor status 143, got ${descendant_supervisor_status}"
wait_for_log_count 1 "dev descendant received TERM" ||
  fail "development descendant did not receive TERM"
wait_for_process_exit "${descendant_pid}" || fail "development descendant leaked"
DEV_DESCENDANT_MODE=""

printf '%s\n' "PASS: development descendant cleanup"
