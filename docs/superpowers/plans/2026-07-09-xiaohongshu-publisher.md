# Xiaohongshu Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-account, independent Xiaohongshu publishing workflow in Mercury with local task tracking and a replaceable Playwright provider.

**Architecture:** Add a focused publishing domain to `packages/api`, persistence tables to `packages/db`, and a dashboard workspace in `apps/web`. The mock provider and task service are implemented first so the core flow is testable before the real browser automation provider is wired in.

**Tech Stack:** Next.js App Router, React 19, tRPC v11, Drizzle ORM/Postgres, Zod, Vitest, Playwright, Ultracite/Biome.

---

## File Structure

Create:

- `vitest.config.ts` - root Vitest config for API/domain tests and light React smoke tests.
- `packages/db/src/schema/xiaohongshu-publisher.ts` - Drizzle tables and enums for the single-account config, publish tasks, and logs.
- `packages/api/src/routers/xiaohongshu-publisher/schema.ts` - Zod schemas, status constants, and public DTO types.
- `packages/api/src/routers/xiaohongshu-publisher/repository.ts` - repository interface and serializable row types.
- `packages/api/src/routers/xiaohongshu-publisher/memory-repository.ts` - deterministic in-memory repository for tests.
- `packages/api/src/routers/xiaohongshu-publisher/db-repository.ts` - Drizzle-backed repository.
- `packages/api/src/routers/xiaohongshu-publisher/provider.ts` - provider interface and provider result types.
- `packages/api/src/routers/xiaohongshu-publisher/mock-provider.ts` - success/failure mock provider.
- `packages/api/src/routers/xiaohongshu-publisher/playwright-provider.ts` - real local browser automation provider.
- `packages/api/src/routers/xiaohongshu-publisher/service.ts` - task orchestration and state transitions.
- `packages/api/src/routers/xiaohongshu-publisher/router.ts` - tRPC router.
- `packages/api/src/routers/xiaohongshu-publisher/index.ts` - public exports.
- `packages/api/src/routers/xiaohongshu-publisher/*.test.ts` - Vitest tests for schemas, repository, provider, service, and router.
- `apps/web/src/app/dashboard/xiaohongshu/page.tsx` - protected page shell.
- `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.tsx` - client publish workspace.
- `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.test.tsx` - UI smoke test with mocked tRPC hooks.

Modify:

- `package.json` - add `test` script and Vitest/testing dev dependencies.
- `packages/api/package.json` - add the `playwright` dependency for the local browser provider.
- `packages/db/src/index.ts` - include new tables in Drizzle schema object.
- `packages/db/src/schema/index.ts` - export new schema file.
- `packages/api/src/routers/index.ts` - mount `xiaohongshuPublisher`.
- `packages/env/src/server.ts` - add provider/profile/artifact environment variables with defaults.
- `apps/web/src/app/dashboard/page.tsx` - link to Xiaohongshu publisher.

---

### Task 1: Test Harness and Payload Schema

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/schema.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/schema.test.ts`

- [ ] **Step 1: Add the test command and dependencies**

Edit root `package.json`:

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@testing-library/react": "^17.0.0",
    "@testing-library/user-event": "^15.0.0",
    "jsdom": "^27.0.0",
    "vitest": "^4.0.0"
  }
}
```

Keep existing scripts and dependencies. Add only the missing keys.

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: install exits `0` and updates `package-lock.json`.

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		include: [
			"packages/**/*.test.ts",
			"packages/**/*.test.tsx",
			"apps/**/*.test.ts",
			"apps/**/*.test.tsx",
		],
	},
});
```

- [ ] **Step 4: Write failing schema tests**

Create `packages/api/src/routers/xiaohongshu-publisher/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
	createPublishTaskInputSchema,
	normalizeTopics,
	xiaohongshuVisibilityValues,
} from "./schema";

describe("createPublishTaskInputSchema", () => {
	it("accepts a valid image-text note payload", () => {
		const result = createPublishTaskInputSchema.parse({
			content: "正文内容 #探店",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: "/tmp/cover.png",
					size: 1024,
					type: "image",
				},
			],
			title: "探店笔记",
			topics: ["探店", "咖啡"],
			visibility: "public",
		});

		expect(result.topics).toEqual(["探店", "咖啡"]);
		expect(result.visibility).toBe("public");
	});

	it("requires at least one media item", () => {
		const result = createPublishTaskInputSchema.safeParse({
			content: "正文内容",
			media: [],
			title: "标题",
			topics: [],
			visibility: "public",
		});

		expect(result.success).toBe(false);
	});

	it("normalizes topics by trimming hashtags and empty values", () => {
		expect(normalizeTopics([" #咖啡 ", "", "探店", "#咖啡"])).toEqual([
			"咖啡",
			"探店",
		]);
	});

	it("keeps the supported visibility values explicit", () => {
		expect(xiaohongshuVisibilityValues).toEqual([
			"public",
			"private",
			"followers",
		]);
	});
});
```

- [ ] **Step 5: Run the schema test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/schema.test.ts
```

Expected: FAIL because `./schema` does not exist.

- [ ] **Step 6: Implement schema and types**

Create `packages/api/src/routers/xiaohongshu-publisher/schema.ts`:

```ts
import { z } from "zod";

export const xiaohongshuVisibilityValues = [
	"public",
	"private",
	"followers",
] as const;

export const xiaohongshuTaskStatusValues = [
	"created",
	"validating",
	"opening_browser",
	"checking_login",
	"uploading_media",
	"filling_form",
	"submitting",
	"verifying_result",
	"succeeded",
	"failed",
	"submitted_unknown",
] as const;

export const xiaohongshuAccountStatusValues = [
	"not_configured",
	"login_required",
	"ready",
	"expired",
	"error",
] as const;

export const xiaohongshuMediaTypeValues = ["image", "video"] as const;

export const xiaohongshuMediaSchema = z.object({
	mimeType: z.string().min(1),
	name: z.string().min(1),
	path: z.string().min(1),
	size: z.number().int().positive(),
	type: z.enum(xiaohongshuMediaTypeValues),
});

export const createPublishTaskInputSchema = z.object({
	content: z.string().trim().min(1).max(5000),
	media: z.array(xiaohongshuMediaSchema).min(1).max(18),
	title: z.string().trim().min(1).max(60),
	topics: z.array(z.string()).default([]).transform((topics) => normalizeTopics(topics)),
	visibility: z.enum(xiaohongshuVisibilityValues).default("public"),
});

export const publishTaskInputSchema = z.object({
	taskId: z.string().min(1),
});

export const getTaskInputSchema = z.object({
	taskId: z.string().min(1),
});

export type XiaohongshuVisibility = (typeof xiaohongshuVisibilityValues)[number];
export type XiaohongshuTaskStatus = (typeof xiaohongshuTaskStatusValues)[number];
export type XiaohongshuAccountStatus =
	(typeof xiaohongshuAccountStatusValues)[number];
export type XiaohongshuMediaType = (typeof xiaohongshuMediaTypeValues)[number];
export type XiaohongshuMedia = z.infer<typeof xiaohongshuMediaSchema>;
export type CreatePublishTaskInput = z.input<typeof createPublishTaskInputSchema>;
export type NormalizedPublishTaskInput = z.output<
	typeof createPublishTaskInputSchema
>;

export function normalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];

	for (const topic of topics) {
		const value = topic.trim().replace(/^#+/, "").trim();
		if (!value || seen.has(value)) {
			continue;
		}

		seen.add(value);
		normalized.push(value);
	}

	return normalized;
}
```

- [ ] **Step 7: Run schema test and verify GREEN**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/schema.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run formatter/check**

Run:

```bash
npm exec -- ultracite fix
npm exec -- ultracite check
```

Expected: both exit `0`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts packages/api/src/routers/xiaohongshu-publisher/schema.ts packages/api/src/routers/xiaohongshu-publisher/schema.test.ts
git commit -m "test: add Xiaohongshu publisher schema"
```

---

### Task 2: Database Schema

**Files:**

- Create: `packages/db/src/schema/xiaohongshu-publisher.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/db-schema.test.ts`

- [ ] **Step 1: Write failing import test**

Create `packages/api/src/routers/xiaohongshu-publisher/db-schema.test.ts`:

```ts
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	xhsAccountConfig,
	xhsPublishTask,
	xhsPublishTaskLog,
} from "@mercury/db/schema/xiaohongshu-publisher";

describe("xiaohongshu publisher database schema", () => {
	it("exports the expected table names", () => {
		expect(getTableName(xhsAccountConfig)).toBe("xhs_account_config");
		expect(getTableName(xhsPublishTask)).toBe("xhs_publish_task");
		expect(getTableName(xhsPublishTaskLog)).toBe("xhs_publish_task_log");
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/db-schema.test.ts
```

Expected: FAIL because `@mercury/db/schema/xiaohongshu-publisher` does not exist.

- [ ] **Step 3: Add Drizzle tables**

Create `packages/db/src/schema/xiaohongshu-publisher.ts`:

```ts
import { relations } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const xhsAccountStatus = pgEnum("xhs_account_status", [
	"not_configured",
	"login_required",
	"ready",
	"expired",
	"error",
]);

export const xhsTaskStatus = pgEnum("xhs_task_status", [
	"created",
	"validating",
	"opening_browser",
	"checking_login",
	"uploading_media",
	"filling_form",
	"submitting",
	"verifying_result",
	"succeeded",
	"failed",
	"submitted_unknown",
]);

export const xhsTaskLogLevel = pgEnum("xhs_task_log_level", [
	"info",
	"warn",
	"error",
]);

export const xhsAccountConfig = pgTable(
	"xhs_account_config",
	{
		createdAt: timestamp("created_at").defaultNow().notNull(),
		displayName: text("display_name"),
		id: text("id").primaryKey(),
		lastCheckedAt: timestamp("last_checked_at"),
		lastLoginAt: timestamp("last_login_at"),
		profilePath: text("profile_path"),
		status: xhsAccountStatus("status").default("not_configured").notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("xhs_account_config_user_id_idx").on(table.userId),
		index("xhs_account_config_status_idx").on(table.status),
	]
);

export const xhsPublishTask = pgTable(
	"xhs_publish_task",
	{
		content: text("content").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		debugScreenshotPath: text("debug_screenshot_path"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		id: text("id").primaryKey(),
		media: jsonb("media").$type<
			Array<{
				mimeType: string;
				name: string;
				path: string;
				size: number;
				type: "image" | "video";
			}>
		>().notNull(),
		publishedAt: timestamp("published_at"),
		resultUrl: text("result_url"),
		status: xhsTaskStatus("status").default("created").notNull(),
		title: text("title").notNull(),
		topics: jsonb("topics").$type<string[]>().default([]).notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		visibility: text("visibility").default("public").notNull(),
	},
	(table) => [
		index("xhs_publish_task_user_id_idx").on(table.userId),
		index("xhs_publish_task_status_idx").on(table.status),
		index("xhs_publish_task_created_at_idx").on(table.createdAt),
	]
);

export const xhsPublishTaskLog = pgTable(
	"xhs_publish_task_log",
	{
		createdAt: timestamp("created_at").defaultNow().notNull(),
		id: text("id").primaryKey(),
		level: xhsTaskLogLevel("level").default("info").notNull(),
		message: text("message").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		step: text("step").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => xhsPublishTask.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("xhs_publish_task_log_task_id_idx").on(table.taskId),
		index("xhs_publish_task_log_created_at_idx").on(table.createdAt),
	]
);

export const xhsAccountConfigRelations = relations(
	xhsAccountConfig,
	({ one }) => ({
		user: one(user, {
			fields: [xhsAccountConfig.userId],
			references: [user.id],
		}),
	})
);

export const xhsPublishTaskRelations = relations(
	xhsPublishTask,
	({ many, one }) => ({
		logs: many(xhsPublishTaskLog),
		user: one(user, {
			fields: [xhsPublishTask.userId],
			references: [user.id],
		}),
	})
);

export const xhsPublishTaskLogRelations = relations(
	xhsPublishTaskLog,
	({ one }) => ({
		task: one(xhsPublishTask, {
			fields: [xhsPublishTaskLog.taskId],
			references: [xhsPublishTask.id],
		}),
	})
);
```

- [ ] **Step 4: Export schema**

Modify `packages/db/src/schema/index.ts`:

```ts
export * from "./auth";
export * from "./xiaohongshu-publisher";
```

- [ ] **Step 5: Add new tables to Drizzle schema object**

Modify `packages/db/src/index.ts` by importing the new tables and adding them to `schema`:

```ts
import {
	xhsAccountConfig,
	xhsAccountConfigRelations,
	xhsPublishTask,
	xhsPublishTaskLog,
	xhsPublishTaskLogRelations,
	xhsPublishTaskRelations,
} from "./schema/xiaohongshu-publisher";

const schema = {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
	xhsAccountConfig,
	xhsAccountConfigRelations,
	xhsPublishTask,
	xhsPublishTaskLog,
	xhsPublishTaskLogRelations,
	xhsPublishTaskRelations,
};
```

Keep the existing auth schema imports.

- [ ] **Step 6: Run test and verify GREEN**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/db-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Generate migration**

Run:

```bash
npm run db:generate
```

Expected: Drizzle creates a new migration under `packages/db/src/migrations`.

- [ ] **Step 8: Run checks**

Run:

```bash
npm exec -- ultracite fix
npm exec -- ultracite check
npm run test -- packages/api/src/routers/xiaohongshu-publisher/schema.test.ts packages/api/src/routers/xiaohongshu-publisher/db-schema.test.ts
```

Expected: all exit `0`.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/xiaohongshu-publisher.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/src/migrations packages/api/src/routers/xiaohongshu-publisher/db-schema.test.ts
git commit -m "feat: add Xiaohongshu publisher tables"
```

---

### Task 3: Repository Layer

**Files:**

- Create: `packages/api/src/routers/xiaohongshu-publisher/repository.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/memory-repository.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/db-repository.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `packages/api/src/routers/xiaohongshu-publisher/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createMemoryXiaohongshuPublisherRepository } from "./memory-repository";

const userId = "user-1";

describe("memory Xiaohongshu publisher repository", () => {
	it("creates and reads a publish task with logs", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask({
			content: "正文",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: "/tmp/cover.png",
					size: 100,
					type: "image",
				},
			],
			title: "标题",
			topics: ["咖啡"],
			userId,
			visibility: "public",
		});

		await repository.addTaskLog({
			level: "info",
			message: "created",
			metadata: {},
			step: "created",
			taskId: task.id,
		});

		const found = await repository.getTaskWithLogs(userId, task.id);

		expect(found?.task.title).toBe("标题");
		expect(found?.logs).toHaveLength(1);
	});

	it("updates task status and result", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask({
			content: "正文",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: "/tmp/cover.png",
					size: 100,
					type: "image",
				},
			],
			title: "标题",
			topics: [],
			userId,
			visibility: "public",
		});

		await repository.updateTask(task.id, {
			resultUrl: "https://www.xiaohongshu.com/explore/demo",
			status: "succeeded",
		});

		const found = await repository.getTaskWithLogs(userId, task.id);

		expect(found?.task.status).toBe("succeeded");
		expect(found?.task.resultUrl).toContain("xiaohongshu.com");
	});
});
```

- [ ] **Step 2: Run repository test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/repository.test.ts
```

Expected: FAIL because repository files do not exist.

- [ ] **Step 3: Define repository contract**

Create `packages/api/src/routers/xiaohongshu-publisher/repository.ts`:

```ts
import type {
	NormalizedPublishTaskInput,
	XiaohongshuAccountStatus,
	XiaohongshuMedia,
	XiaohongshuTaskStatus,
	XiaohongshuVisibility,
} from "./schema";

export interface XiaohongshuAccountConfigRow {
	createdAt: Date;
	displayName: string | null;
	id: string;
	lastCheckedAt: Date | null;
	lastLoginAt: Date | null;
	profilePath: string | null;
	status: XiaohongshuAccountStatus;
	updatedAt: Date;
	userId: string;
}

export interface XiaohongshuPublishTaskRow {
	content: string;
	createdAt: Date;
	debugScreenshotPath: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	id: string;
	media: XiaohongshuMedia[];
	publishedAt: Date | null;
	resultUrl: string | null;
	status: XiaohongshuTaskStatus;
	title: string;
	topics: string[];
	updatedAt: Date;
	userId: string;
	visibility: XiaohongshuVisibility;
}

export interface XiaohongshuPublishTaskLogRow {
	createdAt: Date;
	id: string;
	level: "info" | "warn" | "error";
	message: string;
	metadata: Record<string, unknown>;
	step: string;
	taskId: string;
}

export interface CreateTaskRepositoryInput extends NormalizedPublishTaskInput {
	userId: string;
}

export interface AddTaskLogInput {
	level: "info" | "warn" | "error";
	message: string;
	metadata: Record<string, unknown>;
	step: string;
	taskId: string;
}

export interface UpdateTaskInput {
	debugScreenshotPath?: string | null;
	errorCode?: string | null;
	errorMessage?: string | null;
	publishedAt?: Date | null;
	resultUrl?: string | null;
	status?: XiaohongshuTaskStatus;
}

export interface UpsertAccountConfigInput {
	displayName?: string | null;
	lastCheckedAt?: Date | null;
	lastLoginAt?: Date | null;
	profilePath?: string | null;
	status: XiaohongshuAccountStatus;
	userId: string;
}

export interface XiaohongshuPublisherRepository {
	addTaskLog(input: AddTaskLogInput): Promise<XiaohongshuPublishTaskLogRow>;
	createTask(input: CreateTaskRepositoryInput): Promise<XiaohongshuPublishTaskRow>;
	getAccountConfig(userId: string): Promise<XiaohongshuAccountConfigRow | null>;
	getTaskWithLogs(
		userId: string,
		taskId: string
	): Promise<{
		logs: XiaohongshuPublishTaskLogRow[];
		task: XiaohongshuPublishTaskRow;
	} | null>;
	listTasks(userId: string, limit: number): Promise<XiaohongshuPublishTaskRow[]>;
	updateTask(
		taskId: string,
		input: UpdateTaskInput
	): Promise<XiaohongshuPublishTaskRow | null>;
	upsertAccountConfig(
		input: UpsertAccountConfigInput
	): Promise<XiaohongshuAccountConfigRow>;
}

export function createId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}
```

- [ ] **Step 4: Implement memory repository**

Create `packages/api/src/routers/xiaohongshu-publisher/memory-repository.ts`:

```ts
import type {
	AddTaskLogInput,
	CreateTaskRepositoryInput,
	UpdateTaskInput,
	UpsertAccountConfigInput,
	XiaohongshuAccountConfigRow,
	XiaohongshuPublisherRepository,
	XiaohongshuPublishTaskLogRow,
	XiaohongshuPublishTaskRow,
} from "./repository";
import { createId } from "./repository";

export function createMemoryXiaohongshuPublisherRepository(): XiaohongshuPublisherRepository {
	const accounts = new Map<string, XiaohongshuAccountConfigRow>();
	const tasks = new Map<string, XiaohongshuPublishTaskRow>();
	const logs = new Map<string, XiaohongshuPublishTaskLogRow[]>();

	return {
		async addTaskLog(input: AddTaskLogInput) {
			const row: XiaohongshuPublishTaskLogRow = {
				...input,
				createdAt: new Date(),
				id: createId("xhs_log"),
			};
			const taskLogs = logs.get(input.taskId) ?? [];
			taskLogs.push(row);
			logs.set(input.taskId, taskLogs);
			return row;
		},
		async createTask(input: CreateTaskRepositoryInput) {
			const now = new Date();
			const row: XiaohongshuPublishTaskRow = {
				content: input.content,
				createdAt: now,
				debugScreenshotPath: null,
				errorCode: null,
				errorMessage: null,
				id: createId("xhs_task"),
				media: input.media,
				publishedAt: null,
				resultUrl: null,
				status: "created",
				title: input.title,
				topics: input.topics,
				updatedAt: now,
				userId: input.userId,
				visibility: input.visibility,
			};
			tasks.set(row.id, row);
			logs.set(row.id, []);
			return row;
		},
		async getAccountConfig(userId: string) {
			return accounts.get(userId) ?? null;
		},
		async getTaskWithLogs(userId: string, taskId: string) {
			const task = tasks.get(taskId);
			if (!task || task.userId !== userId) {
				return null;
			}
			return {
				logs: logs.get(taskId) ?? [],
				task,
			};
		},
		async listTasks(userId: string, limit: number) {
			return [...tasks.values()]
				.filter((task) => task.userId === userId)
				.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
				.slice(0, limit);
		},
		async updateTask(taskId: string, input: UpdateTaskInput) {
			const existing = tasks.get(taskId);
			if (!existing) {
				return null;
			}
			const updated: XiaohongshuPublishTaskRow = {
				...existing,
				...input,
				updatedAt: new Date(),
			};
			tasks.set(taskId, updated);
			return updated;
		},
		async upsertAccountConfig(input: UpsertAccountConfigInput) {
			const now = new Date();
			const existing = accounts.get(input.userId);
			const row: XiaohongshuAccountConfigRow = {
				createdAt: existing?.createdAt ?? now,
				displayName: input.displayName ?? existing?.displayName ?? null,
				id: existing?.id ?? createId("xhs_account"),
				lastCheckedAt: input.lastCheckedAt ?? existing?.lastCheckedAt ?? null,
				lastLoginAt: input.lastLoginAt ?? existing?.lastLoginAt ?? null,
				profilePath: input.profilePath ?? existing?.profilePath ?? null,
				status: input.status,
				updatedAt: now,
				userId: input.userId,
			};
			accounts.set(input.userId, row);
			return row;
		},
	};
}
```

- [ ] **Step 5: Implement Drizzle repository**

Create `packages/api/src/routers/xiaohongshu-publisher/db-repository.ts`:

```ts
import { db } from "@mercury/db";
import {
	xhsAccountConfig,
	xhsPublishTask,
	xhsPublishTaskLog,
} from "@mercury/db/schema/xiaohongshu-publisher";
import { and, desc, eq } from "drizzle-orm";

import type {
	AddTaskLogInput,
	CreateTaskRepositoryInput,
	UpdateTaskInput,
	UpsertAccountConfigInput,
	XiaohongshuPublisherRepository,
} from "./repository";
import { createId } from "./repository";

export function createDbXiaohongshuPublisherRepository(): XiaohongshuPublisherRepository {
	return {
		async addTaskLog(input: AddTaskLogInput) {
			const [row] = await db
				.insert(xhsPublishTaskLog)
				.values({
					...input,
					id: createId("xhs_log"),
				})
				.returning();
			return row;
		},
		async createTask(input: CreateTaskRepositoryInput) {
			const [row] = await db
				.insert(xhsPublishTask)
				.values({
					content: input.content,
					id: createId("xhs_task"),
					media: input.media,
					title: input.title,
					topics: input.topics,
					userId: input.userId,
					visibility: input.visibility,
				})
				.returning();
			return row;
		},
		async getAccountConfig(userId: string) {
			const [row] = await db
				.select()
				.from(xhsAccountConfig)
				.where(eq(xhsAccountConfig.userId, userId))
				.limit(1);
			return row ?? null;
		},
		async getTaskWithLogs(userId: string, taskId: string) {
			const [task] = await db
				.select()
				.from(xhsPublishTask)
				.where(and(eq(xhsPublishTask.userId, userId), eq(xhsPublishTask.id, taskId)))
				.limit(1);
			if (!task) {
				return null;
			}
			const logs = await db
				.select()
				.from(xhsPublishTaskLog)
				.where(eq(xhsPublishTaskLog.taskId, taskId))
				.orderBy(xhsPublishTaskLog.createdAt);
			return { logs, task };
		},
		async listTasks(userId: string, limit: number) {
			return db
				.select()
				.from(xhsPublishTask)
				.where(eq(xhsPublishTask.userId, userId))
				.orderBy(desc(xhsPublishTask.createdAt))
				.limit(limit);
		},
		async updateTask(taskId: string, input: UpdateTaskInput) {
			const [row] = await db
				.update(xhsPublishTask)
				.set(input)
				.where(eq(xhsPublishTask.id, taskId))
				.returning();
			return row ?? null;
		},
		async upsertAccountConfig(input: UpsertAccountConfigInput) {
			const [existing] = await db
				.select()
				.from(xhsAccountConfig)
				.where(eq(xhsAccountConfig.userId, input.userId))
				.limit(1);

			if (existing) {
				const [row] = await db
					.update(xhsAccountConfig)
					.set(input)
					.where(eq(xhsAccountConfig.userId, input.userId))
					.returning();
				return row;
			}

			const [row] = await db
				.insert(xhsAccountConfig)
				.values({
					...input,
					id: createId("xhs_account"),
				})
				.returning();
			return row;
		},
	};
}
```

- [ ] **Step 6: Run repository tests**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run checks**

Run:

```bash
npm exec -- ultracite fix
npm exec -- ultracite check
npm run test -- packages/api/src/routers/xiaohongshu-publisher
```

Expected: all exit `0`.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routers/xiaohongshu-publisher/repository.ts packages/api/src/routers/xiaohongshu-publisher/memory-repository.ts packages/api/src/routers/xiaohongshu-publisher/db-repository.ts packages/api/src/routers/xiaohongshu-publisher/repository.test.ts
git commit -m "feat: add Xiaohongshu publisher repository"
```

---

### Task 4: Provider Interface and Mock Provider

**Files:**

- Create: `packages/api/src/routers/xiaohongshu-publisher/provider.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/mock-provider.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/provider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Create `packages/api/src/routers/xiaohongshu-publisher/provider.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createMockXiaohongshuPublishProvider } from "./mock-provider";

const publishInput = {
	content: "正文",
	media: [
		{
			mimeType: "image/png",
			name: "cover.png",
			path: "/tmp/cover.png",
			size: 100,
			type: "image" as const,
		},
	],
	taskId: "task-1",
	title: "标题",
	topics: ["咖啡"],
	visibility: "public" as const,
};

describe("mock Xiaohongshu provider", () => {
	it("returns a deterministic success result", async () => {
		const provider = createMockXiaohongshuPublishProvider();

		const result = await provider.publish(publishInput);

		expect(result.status).toBe("succeeded");
		expect(result.resultUrl).toContain("xiaohongshu.com");
	});

	it("can simulate a provider failure", async () => {
		const provider = createMockXiaohongshuPublishProvider({
			mode: "fail",
		});

		const result = await provider.publish(publishInput);

		expect(result.status).toBe("failed");
		expect(result.errorCode).toBe("mock_provider_failed");
	});
});
```

- [ ] **Step 2: Run provider test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/provider.test.ts
```

Expected: FAIL because provider files do not exist.

- [ ] **Step 3: Define provider interface**

Create `packages/api/src/routers/xiaohongshu-publisher/provider.ts`:

```ts
import type {
	XiaohongshuMedia,
	XiaohongshuVisibility,
} from "./schema";

export interface XiaohongshuSessionStatus {
	displayName: string | null;
	profilePath: string | null;
	status: "not_configured" | "login_required" | "ready" | "expired" | "error";
}

export interface XiaohongshuPublishInput {
	content: string;
	media: XiaohongshuMedia[];
	taskId: string;
	title: string;
	topics: string[];
	visibility: XiaohongshuVisibility;
}

export type XiaohongshuPublishResult =
	| {
			publishedAt: Date;
			resultUrl: string;
			status: "succeeded";
	  }
	| {
			debugScreenshotPath?: string;
			errorCode: string;
			errorMessage: string;
			status: "failed";
	  }
	| {
			debugScreenshotPath?: string;
			errorCode: "submitted_unknown";
			errorMessage: string;
			status: "submitted_unknown";
	  };

export interface XiaohongshuPublishProvider {
	checkSession(): Promise<XiaohongshuSessionStatus>;
	publish(input: XiaohongshuPublishInput): Promise<XiaohongshuPublishResult>;
}
```

- [ ] **Step 4: Implement mock provider**

Create `packages/api/src/routers/xiaohongshu-publisher/mock-provider.ts`:

```ts
import type {
	XiaohongshuPublishInput,
	XiaohongshuPublishProvider,
	XiaohongshuPublishResult,
	XiaohongshuSessionStatus,
} from "./provider";

interface MockProviderOptions {
	mode?: "success" | "fail" | "submitted_unknown";
}

export function createMockXiaohongshuPublishProvider(
	options: MockProviderOptions = {}
): XiaohongshuPublishProvider {
	const mode = options.mode ?? "success";

	return {
		async checkSession(): Promise<XiaohongshuSessionStatus> {
			return {
				displayName: "Mock Xiaohongshu",
				profilePath: "/tmp/mercury-xhs-profile",
				status: "ready",
			};
		},
		async publish(
			input: XiaohongshuPublishInput
		): Promise<XiaohongshuPublishResult> {
			if (mode === "fail") {
				return {
					errorCode: "mock_provider_failed",
					errorMessage: "Mock provider failed by request.",
					status: "failed",
				};
			}

			if (mode === "submitted_unknown") {
				return {
					errorCode: "submitted_unknown",
					errorMessage: "Mock provider submitted but could not verify the URL.",
					status: "submitted_unknown",
				};
			}

			return {
				publishedAt: new Date(),
				resultUrl: `https://www.xiaohongshu.com/explore/mock-${input.taskId}`,
				status: "succeeded",
			};
		},
	};
}
```

- [ ] **Step 5: Run provider test and verify GREEN**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/provider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run checks and commit**

```bash
npm exec -- ultracite fix
npm exec -- ultracite check
npm run test -- packages/api/src/routers/xiaohongshu-publisher
git add packages/api/src/routers/xiaohongshu-publisher/provider.ts packages/api/src/routers/xiaohongshu-publisher/mock-provider.ts packages/api/src/routers/xiaohongshu-publisher/provider.test.ts
git commit -m "feat: add Xiaohongshu publish provider interface"
```

Expected: all commands exit `0`.

---

### Task 5: Publish Service State Machine

**Files:**

- Create: `packages/api/src/routers/xiaohongshu-publisher/service.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `packages/api/src/routers/xiaohongshu-publisher/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createMemoryXiaohongshuPublisherRepository } from "./memory-repository";
import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import { createXiaohongshuPublisherService } from "./service";

const userId = "user-1";
const payload = {
	content: "正文",
	media: [
		{
			mimeType: "image/png",
			name: "cover.png",
			path: "/tmp/cover.png",
			size: 100,
			type: "image" as const,
		},
	],
	title: "标题",
	topics: ["咖啡"],
	visibility: "public" as const,
};

describe("XiaohongshuPublisherService", () => {
	it("creates and publishes a successful task", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const service = createXiaohongshuPublisherService({
			provider: createMockXiaohongshuPublishProvider(),
			repository,
		});

		const task = await service.createTask(userId, payload);
		const published = await service.publishTask(userId, task.id);
		const found = await repository.getTaskWithLogs(userId, task.id);

		expect(published.status).toBe("succeeded");
		expect(published.resultUrl).toContain("xiaohongshu.com");
		expect(found?.logs.map((log) => log.step)).toContain("submitting");
	});

	it("records provider failures with task logs", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const service = createXiaohongshuPublisherService({
			provider: createMockXiaohongshuPublishProvider({ mode: "fail" }),
			repository,
		});

		const task = await service.createTask(userId, payload);
		const published = await service.publishTask(userId, task.id);
		const found = await repository.getTaskWithLogs(userId, task.id);

		expect(published.status).toBe("failed");
		expect(published.errorCode).toBe("mock_provider_failed");
		expect(found?.logs.at(-1)?.level).toBe("error");
	});
});
```

- [ ] **Step 2: Run service test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/service.test.ts
```

Expected: FAIL because `./service` does not exist.

- [ ] **Step 3: Implement service**

Create `packages/api/src/routers/xiaohongshu-publisher/service.ts`:

```ts
import type { XiaohongshuPublishProvider } from "./provider";
import type {
	XiaohongshuPublisherRepository,
	XiaohongshuPublishTaskRow,
} from "./repository";
import {
	createPublishTaskInputSchema,
	type CreatePublishTaskInput,
	type XiaohongshuTaskStatus,
} from "./schema";

interface XiaohongshuPublisherServiceOptions {
	provider: XiaohongshuPublishProvider;
	repository: XiaohongshuPublisherRepository;
}

export function createXiaohongshuPublisherService({
	provider,
	repository,
}: XiaohongshuPublisherServiceOptions) {
	async function mark(
		taskId: string,
		status: XiaohongshuTaskStatus,
		message: string
	) {
		await repository.updateTask(taskId, { status });
		await repository.addTaskLog({
			level: "info",
			message,
			metadata: {},
			step: status,
			taskId,
		});
	}

	return {
		async createTask(userId: string, input: CreatePublishTaskInput) {
			const parsed = createPublishTaskInputSchema.parse(input);
			const task = await repository.createTask({
				...parsed,
				userId,
			});
			await repository.addTaskLog({
				level: "info",
				message: "Task created.",
				metadata: {},
				step: "created",
				taskId: task.id,
			});
			return task;
		},
		async getAccountStatus(userId: string) {
			const existing = await repository.getAccountConfig(userId);
			if (existing) {
				return existing;
			}

			const session = await provider.checkSession();
			return repository.upsertAccountConfig({
				displayName: session.displayName,
				lastCheckedAt: new Date(),
				profilePath: session.profilePath,
				status: session.status,
				userId,
			});
		},
		async getTask(userId: string, taskId: string) {
			return repository.getTaskWithLogs(userId, taskId);
		},
		async listTasks(userId: string, limit = 20) {
			return repository.listTasks(userId, limit);
		},
		async publishTask(
			userId: string,
			taskId: string
		): Promise<XiaohongshuPublishTaskRow> {
			const found = await repository.getTaskWithLogs(userId, taskId);
			if (!found) {
				throw new Error("Publish task not found.");
			}

			const { task } = found;

			await mark(task.id, "validating", "Validating publish payload.");
			await mark(task.id, "opening_browser", "Opening browser provider.");
			await mark(task.id, "checking_login", "Checking Xiaohongshu login session.");
			await mark(task.id, "uploading_media", "Uploading media.");
			await mark(task.id, "filling_form", "Filling Xiaohongshu publish form.");
			await mark(task.id, "submitting", "Submitting Xiaohongshu note.");

			const result = await provider.publish({
				content: task.content,
				media: task.media,
				taskId: task.id,
				title: task.title,
				topics: task.topics,
				visibility: task.visibility,
			});

			await mark(task.id, "verifying_result", "Verifying publish result.");

			if (result.status === "succeeded") {
				const updated = await repository.updateTask(task.id, {
					publishedAt: result.publishedAt,
					resultUrl: result.resultUrl,
					status: "succeeded",
				});
				await repository.addTaskLog({
					level: "info",
					message: "Publish succeeded.",
					metadata: { resultUrl: result.resultUrl },
					step: "succeeded",
					taskId: task.id,
				});
				return updated ?? task;
			}

			const updated = await repository.updateTask(task.id, {
				debugScreenshotPath: result.debugScreenshotPath ?? null,
				errorCode: result.errorCode,
				errorMessage: result.errorMessage,
				status: result.status,
			});
			await repository.addTaskLog({
				level: "error",
				message: result.errorMessage,
				metadata: { errorCode: result.errorCode },
				step: result.status,
				taskId: task.id,
			});
			return updated ?? task;
		},
	};
}
```

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run checks and commit**

```bash
npm exec -- ultracite fix
npm exec -- ultracite check
npm run test -- packages/api/src/routers/xiaohongshu-publisher
git add packages/api/src/routers/xiaohongshu-publisher/service.ts packages/api/src/routers/xiaohongshu-publisher/service.test.ts
git commit -m "feat: add Xiaohongshu publish service"
```

Expected: all commands exit `0`.

---

### Task 6: tRPC Router Integration

**Files:**

- Create: `packages/api/src/routers/xiaohongshu-publisher/router.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/index.ts`
- Modify: `packages/api/src/routers/index.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/router.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `packages/api/src/routers/xiaohongshu-publisher/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { router } from "../../index";
import { createMemoryXiaohongshuPublisherRepository } from "./memory-repository";
import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import { createXiaohongshuPublisherRouter } from "./router";
import { createXiaohongshuPublisherService } from "./service";

const session = {
	session: {
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 1000),
		id: "session-1",
		token: "token",
		updatedAt: new Date(),
		userId: "user-1",
	},
	user: {
		createdAt: new Date(),
		email: "user@example.com",
		emailVerified: true,
		id: "user-1",
		image: null,
		name: "User",
		updatedAt: new Date(),
	},
};

function createTestCaller() {
	const testRouter = router({
		xiaohongshuPublisher: createXiaohongshuPublisherRouter(
			createXiaohongshuPublisherService({
				provider: createMockXiaohongshuPublishProvider(),
				repository: createMemoryXiaohongshuPublisherRepository(),
			})
		),
	});

	return testRouter.createCaller({
		auth: null,
		session,
	});
}

describe("xiaohongshuPublisher router", () => {
	it("creates, publishes, and reads a task for an authenticated user", async () => {
		const caller = createTestCaller();

		const task = await caller.xiaohongshuPublisher.createTask({
			content: "正文",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: "/tmp/cover.png",
					size: 100,
					type: "image",
				},
			],
			title: "标题",
			topics: ["咖啡"],
			visibility: "public",
		});
		const published = await caller.xiaohongshuPublisher.publishTask({
			taskId: task.id,
		});
		const found = await caller.xiaohongshuPublisher.getTask({
			taskId: task.id,
		});

		expect(published.status).toBe("succeeded");
		expect(found?.task.id).toBe(task.id);
	});
});
```

- [ ] **Step 2: Run router test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/router.test.ts
```

Expected: FAIL because `xiaohongshuPublisher` is not mounted.

- [ ] **Step 3: Create router factory and default router**

Create `packages/api/src/routers/xiaohongshu-publisher/router.ts`:

```ts
import { z } from "zod";

import { protectedProcedure, router } from "../../index";
import { createDbXiaohongshuPublisherRepository } from "./db-repository";
import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import { createXiaohongshuPublisherService } from "./service";
import {
	createPublishTaskInputSchema,
	getTaskInputSchema,
	publishTaskInputSchema,
} from "./schema";

const listTasksInputSchema = z.object({
	limit: z.number().int().min(1).max(50).default(20),
});

type XiaohongshuPublisherService = ReturnType<
	typeof createXiaohongshuPublisherService
>;

export function createXiaohongshuPublisherRouter(
	service: XiaohongshuPublisherService = createXiaohongshuPublisherService({
		provider: createMockXiaohongshuPublishProvider(),
		repository: createDbXiaohongshuPublisherRepository(),
	})
) {
	return router({
		createTask: protectedProcedure
			.input(createPublishTaskInputSchema)
			.mutation(({ ctx, input }) => service.createTask(ctx.session.user.id, input)),
		getAccountStatus: protectedProcedure.query(({ ctx }) =>
			service.getAccountStatus(ctx.session.user.id)
		),
		getTask: protectedProcedure
			.input(getTaskInputSchema)
			.query(({ ctx, input }) => service.getTask(ctx.session.user.id, input.taskId)),
		listTasks: protectedProcedure
			.input(listTasksInputSchema)
			.query(({ ctx, input }) =>
				service.listTasks(ctx.session.user.id, input.limit)
			),
		publishTask: protectedProcedure
			.input(publishTaskInputSchema)
			.mutation(({ ctx, input }) =>
				service.publishTask(ctx.session.user.id, input.taskId)
			),
	});
}

export const xiaohongshuPublisherRouter = createXiaohongshuPublisherRouter();
```

- [ ] **Step 4: Export router module**

Create `packages/api/src/routers/xiaohongshu-publisher/index.ts`:

```ts
export { xiaohongshuPublisherRouter } from "./router";
export type { XiaohongshuPublishProvider } from "./provider";
```

- [ ] **Step 5: Mount router**

Modify `packages/api/src/routers/index.ts`:

```ts
import { xiaohongshuPublisherRouter } from "./xiaohongshu-publisher";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => "OK"),
	privateData: protectedProcedure.query(({ ctx }) => ({
		message: "This is private",
		user: ctx.session.user,
	})),
	xiaohongshuPublisher: xiaohongshuPublisherRouter,
});
```

- [ ] **Step 6: Run router test and verify GREEN**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/router.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full API tests and checks**

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher
npm exec -- ultracite fix
npm exec -- ultracite check
```

Expected: all exit `0`.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routers/index.ts packages/api/src/routers/xiaohongshu-publisher/router.ts packages/api/src/routers/xiaohongshu-publisher/index.ts packages/api/src/routers/xiaohongshu-publisher/router.test.ts
git commit -m "feat: expose Xiaohongshu publisher API"
```

---

### Task 7: Dashboard UI with Mock Provider Flow

**Files:**

- Create: `apps/web/src/app/dashboard/xiaohongshu/page.tsx`
- Create: `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.tsx`
- Create: `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.test.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`

- [ ] **Step 1: Write UI smoke test**

Create `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import XiaohongshuPublisher from "./xiaohongshu-publisher";

vi.mock("@/utils/trpc", () => {
	const createdTask = {
		content: "正文",
		createdAt: new Date(),
		id: "task-1",
		media: [],
		resultUrl: null,
		status: "created",
		title: "标题",
		topics: [],
		visibility: "public",
	};

	return {
		trpc: {
			xiaohongshuPublisher: {
				createTask: {
					mutationOptions: () => ({
						mutationFn: async () => createdTask,
					}),
				},
				getAccountStatus: {
					queryOptions: () => ({
						queryFn: async () => ({
							displayName: "我的小红书账号",
							status: "ready",
						}),
						queryKey: ["xhs-account"],
					}),
				},
				listTasks: {
					queryOptions: () => ({
						queryFn: async () => [],
						queryKey: ["xhs-tasks"],
					}),
				},
				publishTask: {
					mutationOptions: () => ({
						mutationFn: async () => ({
							...createdTask,
							resultUrl: "https://www.xiaohongshu.com/explore/mock",
							status: "succeeded",
						}),
					}),
				},
			},
		},
	};
});

describe("XiaohongshuPublisher", () => {
	it("submits a basic image-text publish task", async () => {
		const user = userEvent.setup();
		render(<XiaohongshuPublisher />);

		await user.type(screen.getByLabelText("标题"), "探店笔记");
		await user.type(screen.getByLabelText("正文"), "今天的咖啡很好喝");
		await user.type(screen.getByLabelText("媒体路径"), "/tmp/cover.png");
		await user.click(screen.getByRole("button", { name: "一键发布到小红书" }));

		expect(await screen.findByText("发布成功")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run UI test and verify RED**

Run:

```bash
npm run test -- apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create protected page shell**

Create `apps/web/src/app/dashboard/xiaohongshu/page.tsx`:

```tsx
import { auth } from "@mercury/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import XiaohongshuPublisher from "./xiaohongshu-publisher";

export default async function XiaohongshuPublisherPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/login");
	}

	return <XiaohongshuPublisher />;
}
```

- [ ] **Step 4: Implement client publisher workspace**

Create `apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.tsx`:

```tsx
"use client";

import { Button } from "@mercury/ui/components/button";
import { Card } from "@mercury/ui/components/card";
import { Input } from "@mercury/ui/components/input";
import { Label } from "@mercury/ui/components/label";
import { Textarea } from "@mercury/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useMemo, useState } from "react";

import { queryClient, trpc } from "@/utils/trpc";

function parseTopics(value: string): string[] {
	return value
		.split(/[,\s]+/u)
		.map((topic) => topic.trim())
		.filter(Boolean);
}

export default function XiaohongshuPublisher() {
	const [content, setContent] = useState("");
	const [mediaPath, setMediaPath] = useState("");
	const [resultText, setResultText] = useState("");
	const [title, setTitle] = useState("");
	const [topics, setTopics] = useState("");
	const [visibility, setVisibility] = useState<"public" | "private" | "followers">(
		"public"
	);

	const accountStatus = useQuery(
		trpc.xiaohongshuPublisher.getAccountStatus.queryOptions()
	);
	const tasks = useQuery(
		trpc.xiaohongshuPublisher.listTasks.queryOptions({ limit: 5 })
	);
	const createTask = useMutation(
		trpc.xiaohongshuPublisher.createTask.mutationOptions()
	);
	const publishTask = useMutation(
		trpc.xiaohongshuPublisher.publishTask.mutationOptions()
	);

	const checks = useMemo(
		() => [
			{ label: "标题不为空", valid: title.trim().length > 0 },
			{ label: "正文不为空", valid: content.trim().length > 0 },
			{ label: "至少一个媒体路径", valid: mediaPath.trim().length > 0 },
			{ label: "账号会话可用", valid: accountStatus.data?.status === "ready" },
		],
		[accountStatus.data?.status, content, mediaPath, title]
	);
	const canPublish = checks.every((check) => check.valid);

	async function handlePublish() {
		setResultText("");
		const task = await createTask.mutateAsync({
			content,
			media: [
				{
					mimeType: mediaPath.endsWith(".mp4") ? "video/mp4" : "image/png",
					name: mediaPath.split("/").at(-1) ?? "media",
					path: mediaPath,
					size: 1,
					type: mediaPath.endsWith(".mp4") ? "video" : "image",
				},
			],
			title,
			topics: parseTopics(topics),
			visibility,
		});
		const published = await publishTask.mutateAsync({ taskId: task.id });
		await queryClient.invalidateQueries();
		setResultText(
			published.status === "succeeded"
				? "发布成功"
				: published.errorMessage ?? "发布未完成"
		);
	}

	return (
		<main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
			<header>
				<h1 className="font-semibold text-2xl">小红书发布</h1>
				<p className="text-muted-foreground text-sm">
					单账号发布台，使用本机浏览器会话完成发布。
				</p>
			</header>
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<Card className="flex flex-col gap-4 p-4">
					<div className="grid gap-2">
						<Label htmlFor="xhs-title">标题</Label>
						<Input
							id="xhs-title"
							onChange={(event) => setTitle(event.target.value)}
							value={title}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="xhs-content">正文</Label>
						<Textarea
							id="xhs-content"
							onChange={(event) => setContent(event.target.value)}
							value={content}
						/>
					</div>
					<div className="grid gap-2 md:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="xhs-topics">话题</Label>
							<Input
								id="xhs-topics"
								onChange={(event) => setTopics(event.target.value)}
								placeholder="#咖啡 #探店"
								value={topics}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="xhs-visibility">可见性</Label>
							<select
								className="h-8 border bg-background px-2 text-xs"
								id="xhs-visibility"
								onChange={(event) =>
									setVisibility(
										event.target.value as "public" | "private" | "followers"
									)
								}
								value={visibility}
							>
								<option value="public">公开</option>
								<option value="private">私密</option>
								<option value="followers">粉丝可见</option>
							</select>
						</div>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="xhs-media-path">媒体路径</Label>
						<Input
							id="xhs-media-path"
							onChange={(event) => setMediaPath(event.target.value)}
							placeholder="/Users/harold/Pictures/note.png"
							value={mediaPath}
						/>
					</div>
					<div className="flex justify-end gap-2">
						<Button
							disabled={
								!canPublish || createTask.isPending || publishTask.isPending
							}
							onClick={handlePublish}
						>
							<Send />
							一键发布到小红书
						</Button>
					</div>
					{resultText ? <p className="text-sm">{resultText}</p> : null}
				</Card>
				<aside className="flex flex-col gap-4">
					<Card className="p-4">
						<h2 className="font-medium">账号</h2>
						<p className="text-muted-foreground text-sm">
							{accountStatus.data?.displayName ?? "我的小红书账号"}
						</p>
						<p className="text-sm">状态：{accountStatus.data?.status ?? "..."}</p>
					</Card>
					<Card className="p-4">
						<h2 className="font-medium">发布前检查</h2>
						<ul className="mt-2 grid gap-1 text-sm">
							{checks.map((check) => (
								<li key={check.label}>
									{check.valid ? "✓" : "·"} {check.label}
								</li>
							))}
						</ul>
					</Card>
					<Card className="p-4">
						<h2 className="font-medium">最近任务</h2>
						<ul className="mt-2 grid gap-1 text-sm">
							{tasks.data?.map((task) => (
								<li key={task.id}>
									{task.title} · {task.status}
								</li>
							))}
						</ul>
					</Card>
				</aside>
			</div>
		</main>
	);
}
```

- [ ] **Step 5: Add dashboard link**

Modify `apps/web/src/app/dashboard/page.tsx`:

```tsx
import Link from "next/link";

// inside returned JSX, after <Dashboard />
<Link href="/dashboard/xiaohongshu">打开小红书发布台</Link>
```

- [ ] **Step 6: Run UI test and verify GREEN**

Run:

```bash
npm run test -- apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.test.tsx --environment jsdom
```

Expected: PASS.

- [ ] **Step 7: Run checks and commit**

```bash
npm exec -- ultracite fix
npm exec -- ultracite check
npm run test -- apps/web/src/app/dashboard/xiaohongshu/xiaohongshu-publisher.test.tsx --environment jsdom
git add apps/web/src/app/dashboard/page.tsx apps/web/src/app/dashboard/xiaohongshu
git commit -m "feat: add Xiaohongshu publisher dashboard"
```

Expected: all commands exit `0`.

---

### Task 8: Playwright Provider and Manual Acceptance Path

**Files:**

- Modify: `packages/api/package.json`
- Modify: `packages/env/src/server.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/playwright-provider.ts`
- Modify: `packages/api/src/routers/xiaohongshu-publisher/router.ts`
- Create: `packages/api/src/routers/xiaohongshu-publisher/provider-factory.ts`
- Test: `packages/api/src/routers/xiaohongshu-publisher/provider-factory.test.ts`

- [ ] **Step 1: Add provider environment config**

Modify `packages/env/src/server.ts`:

```ts
server: {
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.url(),
	CORS_ORIGIN: z.url(),
	DATABASE_URL: z.string().min(1),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	XHS_ARTIFACT_DIR: z.string().default(".data/xhs-artifacts"),
	XHS_PROFILE_DIR: z.string().default(".data/xhs-profile"),
	XHS_PROVIDER: z.enum(["mock", "playwright"]).default("mock"),
},
```

- [ ] **Step 2: Add Playwright dependency**

Modify `packages/api/package.json` dependencies:

```json
{
  "dependencies": {
    "playwright": "^1.58.0"
  }
}
```

Run:

```bash
npm install
```

Expected: install exits `0`.

- [ ] **Step 3: Write failing provider factory test**

Create `packages/api/src/routers/xiaohongshu-publisher/provider-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createXiaohongshuPublishProvider } from "./provider-factory";

describe("createXiaohongshuPublishProvider", () => {
	it("creates the mock provider by default", async () => {
		const provider = createXiaohongshuPublishProvider({
			artifactDir: ".data/test-artifacts",
			profileDir: ".data/test-profile",
			provider: "mock",
		});

		const session = await provider.checkSession();

		expect(session.status).toBe("ready");
	});
});
```

- [ ] **Step 4: Run factory test and verify RED**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher/provider-factory.test.ts
```

Expected: FAIL because `provider-factory.ts` does not exist.

- [ ] **Step 5: Implement Playwright provider**

Create `packages/api/src/routers/xiaohongshu-publisher/playwright-provider.ts`:

```ts
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

import type {
	XiaohongshuPublishInput,
	XiaohongshuPublishProvider,
	XiaohongshuPublishResult,
	XiaohongshuSessionStatus,
} from "./provider";

interface PlaywrightProviderOptions {
	artifactDir: string;
	profileDir: string;
}

const creatorUrl = "https://creator.xiaohongshu.com/";

export function createPlaywrightXiaohongshuPublishProvider(
	options: PlaywrightProviderOptions
): XiaohongshuPublishProvider {
	async function openContext(): Promise<BrowserContext> {
		await mkdir(options.artifactDir, { recursive: true });
		await mkdir(options.profileDir, { recursive: true });
		return chromium.launchPersistentContext(options.profileDir, {
			channel: "chrome",
			headless: false,
			viewport: { height: 900, width: 1440 },
		});
	}

	async function screenshot(page: Page, taskId: string): Promise<string> {
		const screenshotPath = path.join(options.artifactDir, `${taskId}.png`);
		await page.screenshot({ fullPage: true, path: screenshotPath });
		return screenshotPath;
	}

	return {
		async checkSession(): Promise<XiaohongshuSessionStatus> {
			const context = await openContext();
			const page = context.pages()[0] ?? (await context.newPage());
			await page.goto(creatorUrl, { waitUntil: "domcontentloaded" });
			const loginVisible = await page
				.getByText(/登录|扫码/u)
				.first()
				.isVisible()
				.catch(() => false);
			await context.close();
			return {
				displayName: null,
				profilePath: options.profileDir,
				status: loginVisible ? "login_required" : "ready",
			};
		},
		async publish(input: XiaohongshuPublishInput): Promise<XiaohongshuPublishResult> {
			const context = await openContext();
			const page = context.pages()[0] ?? (await context.newPage());

			try {
				await page.goto(creatorUrl, { waitUntil: "domcontentloaded" });
				const loginVisible = await page
					.getByText(/登录|扫码/u)
					.first()
					.isVisible()
					.catch(() => false);
				if (loginVisible) {
					return {
						debugScreenshotPath: await screenshot(page, input.taskId),
						errorCode: "login_required",
						errorMessage: "小红书登录已过期，请在打开的浏览器中重新登录。",
						status: "failed",
					};
				}

				await page.getByText(/发布|发布笔记|上传/u).first().click({ timeout: 15000 });
				const fileInput = page.locator("input[type=file]").first();
				await fileInput.setInputFiles(input.media.map((media) => media.path));
				await page.getByPlaceholder(/标题/u).first().fill(input.title);
				await page
					.getByPlaceholder(/正文|描述|分享/u)
					.first()
					.fill(buildDescription(input));
				await page.getByText(/发布/u).last().click({ timeout: 15000 });
				await page.waitForTimeout(5000);

				const currentUrl = page.url();
				await context.close();

				if (currentUrl.includes("xiaohongshu.com")) {
					return {
						publishedAt: new Date(),
						resultUrl: currentUrl,
						status: "succeeded",
					};
				}

				return {
					errorCode: "submitted_unknown",
					errorMessage: "已点击发布，但未能自动确认作品链接，请到小红书后台核对。",
					status: "submitted_unknown",
				};
			} catch (error) {
				const debugScreenshotPath = await screenshot(page, input.taskId).catch(
					() => undefined
				);
				await context.close();
				return {
					debugScreenshotPath,
					errorCode: "selector_changed",
					errorMessage:
						error instanceof Error
							? `小红书页面自动化失败：${error.message}`
							: "小红书页面自动化失败。",
					status: "failed",
				};
			}
		},
	};
}

function buildDescription(input: XiaohongshuPublishInput): string {
	const topicText = input.topics.map((topic) => `#${topic}`).join(" ");
	return [input.content, topicText].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 6: Implement provider factory**

Create `packages/api/src/routers/xiaohongshu-publisher/provider-factory.ts`:

```ts
import { env } from "@mercury/env/server";

import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import type { XiaohongshuPublishProvider } from "./provider";
import { createPlaywrightXiaohongshuPublishProvider } from "./playwright-provider";

interface ProviderFactoryOptions {
	artifactDir?: string;
	profileDir?: string;
	provider?: "mock" | "playwright";
}

export function createXiaohongshuPublishProvider(
	options: ProviderFactoryOptions = {}
): XiaohongshuPublishProvider {
	const provider = options.provider ?? env.XHS_PROVIDER;
	if (provider === "playwright") {
		return createPlaywrightXiaohongshuPublishProvider({
			artifactDir: options.artifactDir ?? env.XHS_ARTIFACT_DIR,
			profileDir: options.profileDir ?? env.XHS_PROFILE_DIR,
		});
	}

	return createMockXiaohongshuPublishProvider();
}
```

- [ ] **Step 7: Wire factory into router**

Modify `packages/api/src/routers/xiaohongshu-publisher/router.ts`:

```ts
import { createXiaohongshuPublishProvider } from "./provider-factory";

export function createXiaohongshuPublisherRouter(
	service = createXiaohongshuPublisherService({
		provider: createXiaohongshuPublishProvider(),
		repository: createDbXiaohongshuPublisherRepository(),
	})
) {
	// existing procedures
}
```

- [ ] **Step 8: Run tests and checks**

Run:

```bash
npm run test -- packages/api/src/routers/xiaohongshu-publisher
npm exec -- ultracite fix
npm exec -- ultracite check
```

Expected: all exit `0`.

- [ ] **Step 9: Manual acceptance**

Run with mock first:

```bash
npm run dev:web
```

Open `http://localhost:3001/dashboard/xiaohongshu`, submit a mock task, and verify success state.

Then run with Playwright provider in `apps/web/.env`:

```env
XHS_PROVIDER=playwright
XHS_PROFILE_DIR=.data/xhs-profile
XHS_ARTIFACT_DIR=.data/xhs-artifacts
```

Run:

```bash
npm run dev:web
```

Open the Xiaohongshu publisher page, trigger account status, complete manual login in the opened browser when the login screen appears, then submit a small test image-text note.

Expected:

- Login-required state is detected on a logged-out profile.
- After manual login, the session status becomes ready.
- A task reaches either `succeeded` with a result URL or `submitted_unknown` with clear guidance.
- On selector failure, `.data/xhs-artifacts/<taskId>.png` is created and the UI displays the error.

- [ ] **Step 10: Commit**

```bash
git add packages/api/package.json package-lock.json packages/env/src/server.ts packages/api/src/routers/xiaohongshu-publisher/playwright-provider.ts packages/api/src/routers/xiaohongshu-publisher/provider-factory.ts packages/api/src/routers/xiaohongshu-publisher/provider-factory.test.ts packages/api/src/routers/xiaohongshu-publisher/router.ts
git commit -m "feat: add local Xiaohongshu Playwright provider"
```

---

### Task 9: Final Verification and Push

**Files:**

- No new files. Corrections are limited to files touched by prior tasks and tied to a concrete verification failure.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run test
npm exec -- ultracite check
npm run check-types
```

Expected:

- `npm run test`: all Vitest tests pass.
- `npm exec -- ultracite check`: exits `0`.
- `npm run check-types`: exits `0`.

- [ ] **Step 2: Review changed files**

Run:

```bash
git status --short
git log --oneline --decorate -10
```

Expected:

- Only intended feature commits are present.
- Existing user-owned untracked `prd/` remains untouched.

- [ ] **Step 3: Push after user approval**

Run:

```bash
git push
```

Expected: remote `main` updates successfully.

---

## Self-Review

Spec coverage:

- Single-account dashboard: Task 7.
- Local task persistence: Tasks 2 and 3.
- Provider interface: Task 4.
- Mock provider and testable task flow: Tasks 4 through 7.
- Playwright provider: Task 8.
- Error screenshots/logs: Tasks 5 and 8.
- Security boundary around cookies/profile: Task 8 stores session only in Playwright profile and does not expose cookies.
- Testing requirements: Tasks 1, 3, 4, 5, 6, 7, and 9.

Placeholder scan:

- No placeholder markers or unspecified future work remains.
- Playwright selectors are explicit in Task 8 and manual acceptance requires screenshot-based verification.

Type consistency:

- Status values come from `schema.ts` and are reused by repository/service/provider tasks.
- Provider result status values match task status values for `succeeded`, `failed`, and `submitted_unknown`.
- Repository row names match the Drizzle table names and service usage.
