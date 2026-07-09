# Single-Account Xiaohongshu Publisher Design

## Goal

Build an independent, closed-loop Xiaohongshu publishing feature inside Mercury. The feature is for one Xiaohongshu account only. It must not depend on AiToEarn services, API keys, relay infrastructure, code, or accounts.

The first version provides a protected web publishing workspace, local task tracking, and a replaceable provider interface. The concrete provider uses local Playwright browser automation against the user's already logged-in Xiaohongshu Creator Center session.

## Scope

In scope:

- One protected dashboard page for Xiaohongshu publishing.
- One Xiaohongshu account session managed through a local browser profile.
- Create, validate, run, and inspect publishing tasks.
- Publish image-text notes and optionally video notes if the browser workflow is stable enough.
- Persist task status, step logs, errors, screenshots, and result links in Mercury.
- Use a mock provider in automated tests and a Playwright provider for local/manual publishing.

Out of scope:

- Multi-account management.
- Multi-platform publishing.
- Calendar scheduling.
- AiToEarn Relay, AiToEarn API keys, or any third-party publishing backend.
- Bypassing CAPTCHA, device verification, anti-bot checks, or account risk controls.
- CI execution of real Xiaohongshu publishing.

## User Experience

The dashboard gets a single "Xiaohongshu Publish" workspace. The layout is dense and operational:

- Left side: title, body, topics, visibility, and media upload/editing.
- Right side: account session status, publish preflight checks, and recent task history.
- Primary action: "Publish to Xiaohongshu".
- Secondary actions: save draft, open browser login, retry failed task, view screenshot/log.

The UI does not ask the user to choose a platform or account. It assumes the one configured Xiaohongshu account.

## Architecture

The feature is split into four boundaries:

- Web UI: form state, validation hints, task submission, task polling.
- tRPC router: authenticated API for account status, task creation, task query, and task execution.
- Database layer: account session metadata, publish tasks, and step logs.
- Publish provider: a replaceable interface. Version one has `MockXiaohongshuProvider` for tests and `PlaywrightXiaohongshuProvider` for local publishing.

The Playwright provider owns all browser automation details. UI and API code should only know about task state and provider results.

## Data Model

`xhs_account_config`

- `id`: stable singleton id.
- `userId`: Better Auth user id.
- `displayName`: optional nickname shown in the UI.
- `status`: `not_configured`, `login_required`, `ready`, `expired`, `error`.
- `profilePath`: server-local Playwright profile path, not exposed to the client.
- `lastLoginAt`: timestamp.
- `lastCheckedAt`: timestamp.
- `createdAt`, `updatedAt`.

`xhs_publish_task`

- `id`.
- `userId`.
- `title`.
- `content`.
- `topics`: JSON string array.
- `visibility`: `public`, `private`, `followers`.
- `media`: JSON array of server-local media descriptors.
- `status`: `created`, `validating`, `opening_browser`, `checking_login`, `uploading_media`, `filling_form`, `submitting`, `verifying_result`, `succeeded`, `failed`, `submitted_unknown`.
- `resultUrl`: nullable Xiaohongshu note URL.
- `errorCode`: nullable stable code.
- `errorMessage`: nullable user-facing summary.
- `debugScreenshotPath`: nullable server-local screenshot path.
- `createdAt`, `updatedAt`, `publishedAt`.

`xhs_publish_task_log`

- `id`.
- `taskId`.
- `step`.
- `level`: `info`, `warn`, `error`.
- `message`.
- `metadata`: JSON object for non-sensitive details.
- `createdAt`.

Media files are stored on the server filesystem for version one because the publishing browser also runs on the same host. A later storage adapter can replace this with object storage without changing the provider interface.

## tRPC API

Router: `xiaohongshuPublisher`.

- `getAccountStatus`: protected query returning safe account/session metadata.
- `startLogin`: protected mutation that launches or prepares the Playwright profile and returns a "continue in browser" state.
- `createTask`: protected mutation that validates payload, stores media metadata, and creates a `created` task.
- `publishTask`: protected mutation that moves a task into execution and calls the provider.
- `getTask`: protected query for one task with logs.
- `listTasks`: protected query for recent tasks.

The first implementation may run `publishTask` synchronously for simplicity, but the state model should remain compatible with a future background worker.

## Provider Interface

The provider contract is independent of UI and database details:

```ts
interface XiaohongshuPublishProvider {
  checkSession(): Promise<XiaohongshuSessionStatus>;
  publish(input: XiaohongshuPublishInput): Promise<XiaohongshuPublishResult>;
}
```

`publish` receives normalized title, content, topics, visibility, and absolute server-local media paths. It returns either a result URL or a structured failure.

The Playwright provider uses a persistent user data directory. It opens Xiaohongshu Creator Center, confirms login, uploads media, fills fields, submits, and attempts to capture the resulting note URL. If it cannot prove the URL after submission, it returns `submitted_unknown`.

## Error Handling

Task execution uses these steps:

`created -> validating -> opening_browser -> checking_login -> uploading_media -> filling_form -> submitting -> verifying_result -> succeeded/failed/submitted_unknown`

Failure behavior:

- Login expired: task fails with `login_required`; UI prompts re-login.
- CAPTCHA or risk check: task fails with a clear manual-action message. The provider must not bypass it.
- Selector missing: task fails with `selector_changed`, captures a screenshot, and records the failed step.
- Media upload failure: task fails with `media_upload_failed` and keeps task/media references for retry.
- Submit clicked but result URL not found: task becomes `submitted_unknown`; UI tells the user to verify in Xiaohongshu.
- Unexpected provider error: task fails with `provider_error`, records a sanitized message and screenshot.

All screenshots and logs must avoid including raw cookies or secrets.

## Security

- Do not expose cookies to the frontend.
- Do not store raw Xiaohongshu cookies in the database.
- Store browser session data only in the local Playwright profile directory.
- Restrict all APIs to authenticated users.
- Avoid logging title/body/media contents in error metadata unless needed for user-visible task history.
- Do not automate CAPTCHA or account verification bypasses.

## Testing

Automated tests use a mock provider:

- Payload validation rejects missing content, missing media, and invalid visibility.
- Task status transitions are deterministic for success and failure.
- `createTask`, `publishTask`, `getTask`, and `listTasks` enforce authentication.
- UI smoke test submits a valid note through the mock provider and renders success/failure states.

Manual acceptance covers the real provider:

- First-run login opens the persistent browser profile.
- A valid image-text note publishes successfully.
- Login-expired state is detected.
- Selector failure captures a screenshot and produces an actionable error.

## Implementation Notes

- Keep the first UI inside the existing dashboard instead of creating a marketing page.
- Use existing shared UI primitives from `packages/ui`.
- Keep the provider in a server-only module so Playwright never enters the client bundle.
- Add Playwright as a server dependency only when implementing the provider.
- Make the provider selectable by environment, with the mock provider usable in development/tests.

## Open Decisions Resolved

- The system is independent from AiToEarn.
- Only one Xiaohongshu account is supported.
- Publishing is local/self-hosted through Playwright browser automation.
- The first version is serial execution: one publish task at a time.
