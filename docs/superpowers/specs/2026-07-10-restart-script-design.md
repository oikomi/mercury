# Full-Stack Restart Script Design

## Goal

Add an executable `restart.sh` at the repository root that reliably restarts Mercury's complete local development environment: PostgreSQL, the Next.js web app, the Expo native app, and the OpenTUI app.

The script stays attached to the terminal so all application logs remain visible. Pressing `Ctrl+C`, receiving `TERM`, or encountering a startup failure stops every application process started by the script and stops PostgreSQL.

## User Contract

Run the script from any directory:

```bash
/Users/harold/dev/webdev/mercury/restart.sh
```

From the repository root, the shorter form is:

```bash
./restart.sh
```

The script must:

- Resolve the repository root from its own location instead of the caller's working directory.
- Check that `npm`, `bun`, `docker`, and `lsof` are available.
- Check that the Docker daemon is reachable.
- Require `apps/web/.env` and `apps/native/.env` to exist.
- Stop a previous development session only when that session was started by this script.
- Refuse to kill unknown processes that occupy the Web or Expo ports.
- Restart PostgreSQL and wait until its Docker health check reports `healthy`.
- Run `npm run dev` in the foreground to start Web, Native, and TUI through Nx.
- Stop the application process tree and PostgreSQL on every exit path.
- Preserve the PostgreSQL volume and stored data.

The script does not install dependencies, run `db:push`, generate migrations, or modify environment files.

## Process Ownership

The supervising shell writes its PID to `.nx/mercury-restart.pid`. The `.nx` directory is already runtime state and is excluded from version control.

At startup, the script reads that file if it exists:

1. Treat malformed PID content as stale state and remove the file.
2. If the PID no longer exists, remove the stale file.
3. If the PID exists, inspect its command and confirm it is this repository's `restart.sh` supervisor.
4. Send `TERM` only after that ownership check succeeds.
5. Wait for the previous supervisor to perform its normal cleanup before continuing.
6. If it does not exit within the bounded wait, stop with an actionable error instead of sending `KILL`.

Cleanup removes the PID file only when the file still contains the current supervisor's PID. This prevents an older process from deleting a newer process's state.

## Port Safety

After the prior managed session exits, the script checks TCP ports `3001` and `8081`, used by Next.js and Expo respectively. If either port is still listening, the script reports the port and owning PID, then exits without terminating that process.

Port `5432` is left to Docker Compose. If another service occupies it, database startup fails normally and the script reports the underlying Docker error. The script never terminates an unknown database process.

## Startup Flow

The startup sequence is:

1. Resolve the repository root and enter it.
2. Validate required commands, Docker availability, and environment files.
3. Stop and await a previous script-managed session.
4. Check for unknown Web or Expo port owners.
5. Record the current supervisor PID and install signal/exit traps.
6. Run `npm run db:stop` to stop an existing Mercury PostgreSQL container.
7. Run `npm run db:start` to start PostgreSQL.
8. Poll the `mercury-postgres` container health status for up to 60 seconds.
9. Start `npm run dev` as a child process and wait for it in the foreground.

The application command inherits standard input, output, and error so Nx, Next.js, Expo, and OpenTUI logs remain visible and interactive terminal behavior is preserved.

## Shutdown And Errors

One idempotent cleanup function handles `INT`, `TERM`, normal application exit, and startup errors. It prevents recursive cleanup, terminates the `npm run dev` child when present, waits for its process tree to exit, runs `npm run db:stop`, and removes the owned PID file.

Expected interruption exits with the conventional signal status. Startup failures retain a non-zero status after cleanup. Database-stop failures during cleanup are reported but do not prevent the remaining cleanup steps.

If `npm run dev` exits on its own, the supervisor treats that as the end of the development session and stops PostgreSQL before returning the application's exit status.

## Testability

The script accepts an internal `MERCURY_RESTART_STATE_DIR` override, defaulting to the repository's `.nx` directory. This lets tests isolate PID state without changing the normal command.

A Shell test uses temporary `npm`, `docker`, `bun`, and `lsof` command shims to exercise real supervisor behavior without starting the developer's services. It verifies:

- Shell syntax and executable permissions.
- Database stop/start occurs before `npm run dev`.
- A termination signal stops the application and database and removes PID state.
- A second invocation terminates and waits for the first managed invocation before starting.
- An unknown listener causes a clear failure and is not killed.

The final verification also runs the repository's Ultracite check to ensure the change does not disturb existing project checks. The restart script is not left running after verification.

## Decisions

- Restart scope: PostgreSQL, Web, Native, and TUI.
- Runtime mode: one foreground terminal with combined Nx logs.
- Exit behavior: `Ctrl+C` stops applications and PostgreSQL.
- Process strategy: PID-managed cleanup; no broad process-name or port-based killing.
- Database schema: no automatic push or migration during restart.
