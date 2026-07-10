# Xiaohongshu Real Account Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local Mock Xiaohongshu account with one manually authenticated, persistent Playwright browser profile.

**Architecture:** The application already has a tested `playwright` provider and a dashboard login action. This plan changes only local runtime configuration: the provider opens Xiaohongshu Creator Center in its own profile, while the user completes login directly in that browser. No credentials, cookies, CAPTCHA bypasses, background schedules, or bulk actions are added.

**Tech Stack:** Next.js, tRPC, Playwright persistent Chrome context, Vitest, local `.env` configuration.

---

### Task 1: Verify The Existing Real Provider Contract

**Files:**
- Test: `packages/api/src/routers/xiaohongshu-publisher/provider-factory.test.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/playwright-provider.test.ts`

- [ ] **Step 1: Run the provider tests before changing local configuration**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/provider-factory.test.ts packages/api/src/routers/xiaohongshu-publisher/playwright-provider.test.ts
```

Expected: the factory creates the Playwright provider without launching a browser, and publish confirmation only accepts a public Xiaohongshu note URL as success.

### Task 2: Enable The Local Real Provider

**Files:**
- Modify: `apps/web/.env`

- [ ] **Step 1: Configure the existing tested provider**

Append the following local-only settings to `apps/web/.env`:

```dotenv
XHS_PROVIDER=playwright
XHS_PROFILE_DIR=.data/xhs-profile
XHS_ARTIFACT_DIR=.data/xhs-artifacts
```

- [ ] **Step 2: Restart the local stack**

Run:

```bash
./restart.sh
```

Expected: Web starts at `http://localhost:18123`; no external publishing occurs during startup.

### Task 3: Manually Authenticate And Verify Session State

**Files:**
- Manual acceptance: `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.tsx`

- [ ] **Step 1: Open the publishing dashboard**

Navigate to:

```text
http://localhost:18123/dashboard/xiaohongshu
```

Expected: a prior Mock session may still appear until the user asks the dashboard to refresh it. No publishing occurs while loading the dashboard.

- [ ] **Step 2: Refresh the cached account status**

Click `重新检测`.

Expected: the Playwright provider replaces the old Mock metadata with the state of `.data/xhs-profile`; a new profile reports `需要登录`.

- [ ] **Step 3: Start manual login**

Click `打开登录窗口` and complete the QR-code or phone login in the opened Xiaohongshu Creator Center window.

Expected: credentials are entered only in Xiaohongshu's browser window. Do not solve CAPTCHA or risk-control challenges through automation.

- [ ] **Step 4: Confirm the real session**

After the login window closes, click `重新检测`.

Expected: the account card changes to `已就绪`; the dashboard enables publishing only when title, body, local media path, and session are all present.

### Task 4: Verify Safety Boundaries

**Files:**
- Verify: `apps/web/.env`
- Verify: `.data/xhs-profile/`
- Verify: `.data/xhs-artifacts/`

- [ ] **Step 1: Confirm local-only session storage**

Run:

```bash
git status --short apps/web/.env .data
```

Expected: neither the environment file nor the browser profile is staged for source control.

- [ ] **Step 2: Confirm intentional publishing behavior**

Expected: no task is created and no browser publish action occurs until the user explicitly clicks `发布到小红书` for a single completed form. The implementation does not schedule, repeat, or bulk-publish notes.
