# Full-Stack Restart Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe foreground `restart.sh` that restarts PostgreSQL, Web, Native, and TUI, then cleans up the complete managed environment on exit.

**Architecture:** A Bash supervisor owns one PID file under `.nx`, launches existing npm scripts, waits for Docker health, and forwards termination through the child process tree. A standalone Bash integration test replaces external commands through `PATH`, allowing lifecycle, restart ownership, and port-conflict behavior to run without touching real developer services.

**Tech Stack:** Bash 3.2-compatible shell, npm/Nx workspace scripts, Docker Compose health checks, temporary command shims.

---

## File Structure

- Create `restart.sh`: repository-root process supervisor and user entry point.
- Create `tests/restart.test.sh`: isolated integration test harness for startup, shutdown, repeated invocation, and port safety.
- Modify `README.md`: document the full-stack restart command and exit behavior.

### Task 1: Foreground Lifecycle Supervisor

**Files:**
- Create: `tests/restart.test.sh`
- Create: `restart.sh`

- [ ] **Step 1: Write the failing lifecycle test**

Create `tests/restart.test.sh` with a temporary runtime directory and fake executables. The first test must require an executable root script, record database/application commands, terminate the supervisor, and assert cleanup:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RESTART_SCRIPT="$ROOT_DIR/restart.sh"
TEST_TEMP="$(mktemp -d)"
SHIM_DIR="$TEST_TEMP/bin"
ACTIVE_PIDS=()

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

cleanup_tests() {
	local pid
	for pid in "${ACTIVE_PIDS[@]:-}"; do
		kill -TERM "$pid" 2>/dev/null || true
	done
	rm -rf "$TEST_TEMP"
}

trap cleanup_tests EXIT
mkdir -p "$SHIM_DIR"

cat >"$SHIM_DIR/npm" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >>"${MERCURY_TEST_LOG:?}"
if [[ "$*" == "run dev" ]]; then
	trap 'printf "dev received TERM\n" >>"${MERCURY_TEST_LOG:?}"; exit 0' TERM INT
	printf 'dev ready\n' >>"${MERCURY_TEST_LOG:?}"
	while :; do
		sleep 0.05
	done
fi
SHIM

cat >"$SHIM_DIR/docker" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
	info)
		exit 0
		;;
	inspect)
		printf 'healthy\n'
		;;
	*)
		exit 0
		;;
esac
SHIM

cat >"$SHIM_DIR/bun" <<'SHIM'
#!/usr/bin/env bash
exit 0
SHIM

cat >"$SHIM_DIR/lsof" <<'SHIM'
#!/usr/bin/env bash
if [[ -n "${MERCURY_TEST_OCCUPIED_PORT:-}" ]] &&
	[[ "$*" == *"-iTCP:${MERCURY_TEST_OCCUPIED_PORT}"* ]]; then
	printf '4242\n'
	exit 0
fi
exit 1
SHIM

chmod +x "$SHIM_DIR/npm" "$SHIM_DIR/docker" "$SHIM_DIR/bun" "$SHIM_DIR/lsof"

wait_for_log() {
	local log_file="$1"
	local pattern="$2"
	local attempt=0
	while ((attempt < 100)); do
		if [[ -f "$log_file" ]] && grep -Fq "$pattern" "$log_file"; then
			return 0
		fi
		sleep 0.05
		attempt=$((attempt + 1))
	done
	fail "Timed out waiting for '$pattern' in $log_file"
}

assert_log_count() {
	local expected="$1"
	local pattern="$2"
	local log_file="$3"
	local actual
	actual="$(grep -Fc "$pattern" "$log_file" || true)"
	[[ "$actual" == "$expected" ]] ||
		fail "Expected '$pattern' $expected time(s), found $actual"
}

assert_log_order() {
	local earlier="$1"
	local later="$2"
	local log_file="$3"
	local earlier_line
	local later_line
	earlier_line="$(grep -Fn "$earlier" "$log_file" | head -n 1 | cut -d: -f1)"
	later_line="$(grep -Fn "$later" "$log_file" | head -n 1 | cut -d: -f1)"
	((earlier_line < later_line)) || fail "Expected '$earlier' before '$later'"
}

test_foreground_lifecycle() {
	local state_dir="$TEST_TEMP/lifecycle-state"
	local log_file="$TEST_TEMP/lifecycle.log"
	local output_file="$TEST_TEMP/lifecycle.out"
	local supervisor_pid
	local status

	[[ -x "$RESTART_SCRIPT" ]] || fail "restart.sh must exist and be executable"

	PATH="$SHIM_DIR:$PATH" \
		MERCURY_TEST_LOG="$log_file" \
		MERCURY_RESTART_STATE_DIR="$state_dir" \
		MERCURY_RESTART_HEALTH_TIMEOUT=2 \
		"$RESTART_SCRIPT" >"$output_file" 2>&1 &
	supervisor_pid=$!
	ACTIVE_PIDS+=("$supervisor_pid")

	wait_for_log "$log_file" "dev ready"
	kill -TERM "$supervisor_pid"
	set +e
	wait "$supervisor_pid"
	status=$?
	set -e

	[[ "$status" == "143" ]] || fail "Expected TERM status 143, found $status"
	assert_log_count 1 "npm run db:start" "$log_file"
	assert_log_count 1 "npm run dev" "$log_file"
	assert_log_count 1 "dev received TERM" "$log_file"
	assert_log_count 2 "npm run db:stop" "$log_file"
	assert_log_order "npm run db:start" "npm run dev" "$log_file"
	[[ ! -e "$state_dir/mercury-restart.pid" ]] || fail "PID file was not removed"
}

test_foreground_lifecycle
printf 'PASS: foreground lifecycle\n'
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bash tests/restart.test.sh
```

Expected: `FAIL: restart.sh must exist and be executable`.

- [ ] **Step 3: Implement the minimal lifecycle supervisor**

Create `restart.sh` with strict mode, prerequisite checks, database health polling, PID ownership for the current run, foreground waiting, and idempotent cleanup:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
STATE_DIR="${MERCURY_RESTART_STATE_DIR:-$ROOT_DIR/.nx}"
PID_FILE="$STATE_DIR/mercury-restart.pid"
DB_CONTAINER="mercury-postgres"
HEALTH_TIMEOUT="${MERCURY_RESTART_HEALTH_TIMEOUT:-60}"
DEV_PID=""
CLEANING_UP=0

log() {
	printf '[mercury] %s\n' "$1"
}

warn() {
	printf '[mercury] Warning: %s\n' "$1" >&2
}

die() {
	printf '[mercury] Error: %s\n' "$1" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

validate_positive_integer() {
	local value="$2"
	case "$2" in
		"" | *[!0-9]*) die "$1 must be a positive integer" ;;
	esac
	((value > 0)) || die "$1 must be a positive integer"
}

check_prerequisites() {
	local command_name
	local env_file
	for command_name in npm bun docker lsof; do
		require_command "$command_name"
	done
	docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"
	for env_file in apps/web/.env apps/native/.env; do
		[[ -f "$ROOT_DIR/$env_file" ]] || die "Missing environment file: $env_file"
	done
}

wait_for_database() {
	local elapsed=0
	local health_status
	while ((elapsed < HEALTH_TIMEOUT)); do
		health_status="$(docker inspect --format '{{.State.Health.Status}}' "$DB_CONTAINER" 2>/dev/null || true)"
		case "$health_status" in
			healthy) return 0 ;;
			unhealthy) die "PostgreSQL health check reported unhealthy" ;;
		esac
		sleep 1
		elapsed=$((elapsed + 1))
	done
	die "PostgreSQL did not become healthy within ${HEALTH_TIMEOUT}s"
}

remove_owned_pid_file() {
	local recorded_pid=""
	[[ -f "$PID_FILE" ]] || return 0
	IFS= read -r recorded_pid <"$PID_FILE" || true
	if [[ "$recorded_pid" == "$$" ]]; then
		rm -f "$PID_FILE"
	fi
}

cleanup() {
	local status="$1"
	if ((CLEANING_UP)); then
		return
	fi
	CLEANING_UP=1
	trap - EXIT INT TERM
	if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
		log "Stopping applications..."
		kill -TERM "$DEV_PID" 2>/dev/null || true
		wait "$DEV_PID" 2>/dev/null || true
	fi
	log "Stopping PostgreSQL..."
	npm run db:stop || warn "PostgreSQL did not stop cleanly"
	remove_owned_pid_file
	exit "$status"
}

main() {
	local status
	cd "$ROOT_DIR"
	validate_positive_integer MERCURY_RESTART_HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
	check_prerequisites
	mkdir -p "$STATE_DIR"
	printf '%s\n' "$$" >"$PID_FILE"
	trap 'cleanup $?' EXIT
	trap 'cleanup 130' INT
	trap 'cleanup 143' TERM

	log "Restarting PostgreSQL..."
	npm run db:stop
	npm run db:start
	wait_for_database
	log "Starting Web, Native, and TUI..."
	npm run dev &
	DEV_PID=$!

	set +e
	wait "$DEV_PID"
	status=$?
	set -e
	DEV_PID=""
	exit "$status"
}

main "$@"
```

Make it executable:

```bash
chmod +x restart.sh tests/restart.test.sh
```

- [ ] **Step 4: Run the lifecycle test and verify GREEN**

Run:

```bash
bash tests/restart.test.sh
```

Expected: `PASS: foreground lifecycle` and exit code `0`.

- [ ] **Step 5: Commit the lifecycle slice**

```bash
git add restart.sh tests/restart.test.sh
git commit -m "Add full-stack restart lifecycle"
```

### Task 2: Managed Restart And Port Safety

**Files:**
- Modify: `tests/restart.test.sh`
- Modify: `restart.sh`

- [ ] **Step 1: Add failing tests for repeated invocation and occupied ports**

Keep the existing lifecycle invocation and PASS output, then append helpers that count log entries, wait for a target count, and exercise the additional cases:

```bash
wait_for_log_count() {
	local log_file="$1"
	local pattern="$2"
	local expected="$3"
	local attempt=0
	local actual
	while ((attempt < 100)); do
		actual="$(grep -Fc "$pattern" "$log_file" 2>/dev/null || true)"
		if ((actual >= expected)); then
			return 0
		fi
		sleep 0.05
		attempt=$((attempt + 1))
	done
	fail "Timed out waiting for $expected occurrence(s) of '$pattern'"
}

wait_for_process_exit() {
	local pid="$1"
	local attempt=0
	while kill -0 "$pid" 2>/dev/null; do
		if ((attempt >= 100)); then
			return 1
		fi
		sleep 0.05
		attempt=$((attempt + 1))
	done
}

test_replaces_managed_session() {
	local state_dir="$TEST_TEMP/restart-state"
	local log_file="$TEST_TEMP/restart.log"
	local first_output="$TEST_TEMP/restart-first.out"
	local second_output="$TEST_TEMP/restart-second.out"
	local first_pid
	local second_pid
	local status

	PATH="$SHIM_DIR:$PATH" MERCURY_TEST_LOG="$log_file" \
		MERCURY_RESTART_STATE_DIR="$state_dir" MERCURY_RESTART_HEALTH_TIMEOUT=2 \
		MERCURY_RESTART_SHUTDOWN_TIMEOUT=2 \
		"$RESTART_SCRIPT" >"$first_output" 2>&1 &
	first_pid=$!
	ACTIVE_PIDS+=("$first_pid")
	wait_for_log_count "$log_file" "dev ready" 1

	PATH="$SHIM_DIR:$PATH" MERCURY_TEST_LOG="$log_file" \
		MERCURY_RESTART_STATE_DIR="$state_dir" MERCURY_RESTART_HEALTH_TIMEOUT=2 \
		MERCURY_RESTART_SHUTDOWN_TIMEOUT=2 \
		"$RESTART_SCRIPT" >"$second_output" 2>&1 &
	second_pid=$!
	ACTIVE_PIDS+=("$second_pid")
	wait_for_process_exit "$first_pid" || fail "First managed supervisor was not stopped"
	wait_for_log_count "$log_file" "dev ready" 2

	set +e
	wait "$first_pid"
	status=$?
	set -e
	[[ "$status" == "143" ]] || fail "First supervisor exited with $status"
	kill -TERM "$second_pid"
	set +e
	wait "$second_pid"
	status=$?
	set -e
	[[ "$status" == "143" ]] || fail "Second supervisor exited with $status"
	assert_log_count 2 "npm run db:start" "$log_file"
	assert_log_count 2 "npm run dev" "$log_file"
	local first_termination_line
	local second_start_line
	first_termination_line="$(grep -Fn "dev received TERM" "$log_file" | head -n 1 | cut -d: -f1)"
	second_start_line="$(grep -Fn "npm run db:start" "$log_file" | sed -n '2p' | cut -d: -f1)"
	((first_termination_line < second_start_line)) ||
		fail "Replacement started before the prior session finished cleanup"
}

test_rejects_unknown_port_owner() {
	local state_dir="$TEST_TEMP/port-state"
	local log_file="$TEST_TEMP/port.log"
	local output_file="$TEST_TEMP/port.out"
	local supervisor_pid
	local status

	PATH="$SHIM_DIR:$PATH" MERCURY_TEST_LOG="$log_file" \
		MERCURY_TEST_OCCUPIED_PORT=3001 MERCURY_RESTART_STATE_DIR="$state_dir" \
		"$RESTART_SCRIPT" >"$output_file" 2>&1 &
	supervisor_pid=$!
	ACTIVE_PIDS+=("$supervisor_pid")
	wait_for_process_exit "$supervisor_pid" || {
		kill -TERM "$supervisor_pid" 2>/dev/null || true
		fail "Occupied-port invocation did not exit"
	}
	set +e
	wait "$supervisor_pid"
	status=$?
	set -e
	[[ "$status" != "0" ]] || fail "Occupied port unexpectedly succeeded"
	grep -Fq "Port 3001 is already in use by PID(s): 4242" "$output_file" ||
		fail "Occupied-port error was not actionable"
	[[ ! -f "$log_file" ]] || ! grep -Fq "npm run db:start" "$log_file" ||
		fail "Database started despite occupied application port"
}

test_refuses_foreign_pid() {
	local state_dir="$TEST_TEMP/foreign-state"
	local log_file="$TEST_TEMP/foreign.log"
	local output_file="$TEST_TEMP/foreign.out"
	local foreign_pid
	local supervisor_pid
	local status

	mkdir -p "$state_dir"
	sleep 30 &
	foreign_pid=$!
	ACTIVE_PIDS+=("$foreign_pid")
	printf '%s\n' "$foreign_pid" >"$state_dir/mercury-restart.pid"
	PATH="$SHIM_DIR:$PATH" MERCURY_TEST_LOG="$log_file" \
		MERCURY_RESTART_STATE_DIR="$state_dir" \
		"$RESTART_SCRIPT" >"$output_file" 2>&1 &
	supervisor_pid=$!
	ACTIVE_PIDS+=("$supervisor_pid")
	wait_for_process_exit "$supervisor_pid" || {
		kill -TERM "$supervisor_pid" 2>/dev/null || true
		fail "Foreign-PID invocation did not exit"
	}
	set +e
	wait "$supervisor_pid"
	status=$?
	set -e
	[[ "$status" != "0" ]] || fail "Foreign PID state unexpectedly succeeded"
	kill -0 "$foreign_pid" 2>/dev/null || fail "Foreign process was terminated"
	grep -Fq "is not this repository's restart supervisor" "$output_file" ||
		fail "Foreign PID error was not actionable"
}

test_replaces_managed_session
test_rejects_unknown_port_owner
test_refuses_foreign_pid
printf 'PASS: managed restart and port safety\n'
```

- [ ] **Step 2: Run the expanded test and verify RED**

Run:

```bash
bash tests/restart.test.sh
```

Expected: `FAIL: First managed supervisor was not stopped`, proving that PID-managed replacement is not implemented yet.

- [ ] **Step 3: Implement canonical ownership, bounded replacement, and port checks**

Add a canonical self-exec after calculating `ROOT_DIR`, so `ps` can verify the absolute script path:

```bash
SCRIPT_PATH="$ROOT_DIR/restart.sh"
if [[ "${MERCURY_RESTART_CANONICAL_PATH:-}" != "$SCRIPT_PATH" ]]; then
	export MERCURY_RESTART_CANONICAL_PATH="$SCRIPT_PATH"
	exec "$SCRIPT_PATH" "$@"
fi
```

Add the shutdown timeout constant and validate it in `main`:

```bash
SHUTDOWN_TIMEOUT="${MERCURY_RESTART_SHUTDOWN_TIMEOUT:-10}"
validate_positive_integer MERCURY_RESTART_SHUTDOWN_TIMEOUT "$SHUTDOWN_TIMEOUT"
```

Add `pgrep` to the prerequisite loop because cleanup uses it to walk the Nx process tree:

```bash
for command_name in npm bun docker lsof pgrep; do
	require_command "$command_name"
done
```

Add these ownership and port functions:

```bash
wait_for_pid_exit() {
	local pid="$1"
	local elapsed=0
	while kill -0 "$pid" 2>/dev/null; do
		if ((elapsed >= SHUTDOWN_TIMEOUT)); then
			return 1
		fi
		sleep 1
		elapsed=$((elapsed + 1))
	done
}

stop_previous_session() {
	local previous_pid=""
	local process_command=""
	[[ -f "$PID_FILE" ]] || return 0
	IFS= read -r previous_pid <"$PID_FILE" || true
	case "$previous_pid" in
		"" | *[!0-9]*)
			warn "Removing malformed restart PID state"
			rm -f "$PID_FILE"
			return 0
			;;
	esac
	if ! kill -0 "$previous_pid" 2>/dev/null; then
		rm -f "$PID_FILE"
		return 0
	fi
	process_command="$(ps -p "$previous_pid" -o command= 2>/dev/null || true)"
	if [[ "$process_command" != *"$SCRIPT_PATH"* ]]; then
		die "PID $previous_pid is live but is not this repository's restart supervisor"
	fi
	log "Stopping previous managed session (PID $previous_pid)..."
	kill -TERM "$previous_pid"
	wait_for_pid_exit "$previous_pid" ||
		die "Previous session did not exit within ${SHUTDOWN_TIMEOUT}s"
}

assert_port_available() {
	local port="$1"
	local listeners
	listeners="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
	if [[ -n "$listeners" ]]; then
		listeners="$(printf '%s\n' "$listeners" | tr '\n' ' ' | sed 's/ $//')"
		die "Port $port is already in use by PID(s): $listeners"
	fi
}
```

In `main`, create the state directory, stop the previous supervisor, check both application ports, and only then write the current PID:

```bash
mkdir -p "$STATE_DIR"
stop_previous_session
assert_port_available 3001
assert_port_available 8081
printf '%s\n' "$$" >"$PID_FILE"
```

Replace direct child termination with a recursive process-tree function so Nx descendants also receive `TERM`:

```bash
terminate_process_tree() {
	local parent_pid="$1"
	local child_pid
	while IFS= read -r child_pid; do
		[[ -n "$child_pid" ]] && terminate_process_tree "$child_pid"
	done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
	kill -TERM "$parent_pid" 2>/dev/null || true
}
```

Call `terminate_process_tree "$DEV_PID"` from cleanup before waiting for the child.

- [ ] **Step 4: Run all restart tests and verify GREEN**

Run:

```bash
bash tests/restart.test.sh
```

Expected:

```text
PASS: foreground lifecycle
PASS: managed restart and port safety
```

- [ ] **Step 5: Commit managed restart behavior**

```bash
git add restart.sh tests/restart.test.sh
git commit -m "Make restart process ownership safe"
```

### Task 3: Documentation And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the restart command**

Add this after the database setup instructions in `README.md`:

````markdown
### Restart the full development environment

To restart PostgreSQL, Web, Native, and TUI together with combined foreground logs:

```bash
./restart.sh
```

Press `Ctrl+C` to stop every application and PostgreSQL cleanly.
````

Add this entry to Available Scripts:

```markdown
- `./restart.sh`: Restart PostgreSQL, Web, Native, and TUI; stop all services on exit
```

- [ ] **Step 2: Verify documentation and shell syntax**

Run:

```bash
rg -n "restart\.sh|Ctrl\+C" README.md
bash -n restart.sh tests/restart.test.sh
test -x restart.sh
test -x tests/restart.test.sh
```

Expected: README matches are printed and all commands exit `0`.

- [ ] **Step 3: Run behavioral and repository checks**

Run:

```bash
bash tests/restart.test.sh
npm exec -- ultracite check
npm run check-types
git diff --check
```

Expected: restart tests, Ultracite, type checking, and whitespace validation all pass. Run these commands from the isolated implementation worktree so the main workspace's separate nested worktree is outside Biome's scan root.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "Document full-stack restart command"
```

- [ ] **Step 5: Perform a final clean-state check**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: no implementation files are uncommitted, and the three restart-script commits are the latest commits on the feature branch.
