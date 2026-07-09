import {
	xhsAccountConfig,
	xhsPublishTask,
} from "@mercury/db/schema/xiaohongshu-publisher";
import { describe, expect, it, vi } from "vitest";

import { createDbXiaohongshuPublisherRepository } from "./db-repository";
import { createMemoryXiaohongshuPublisherRepository } from "./memory-repository";
import {
	activeXiaohongshuPublishTaskStatuses,
	type XiaohongshuPublishTaskRow,
} from "./repository";

vi.mock("@mercury/db", () => ({
	db: {},
}));

const userId = "user-1";
type DatabaseParameter = NonNullable<
	Parameters<typeof createDbXiaohongshuPublisherRepository>[0]
>;

interface ConflictUpdateConfig {
	set: unknown;
	target: unknown;
}

const createTaskInput = {
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
} as const;

const createTaskRow = (
	overrides: Partial<XiaohongshuPublishTaskRow> = {}
): XiaohongshuPublishTaskRow => {
	const now = new Date("2026-01-01T00:00:00.000Z");

	return {
		content: createTaskInput.content,
		createdAt: now,
		debugScreenshotPath: null,
		errorCode: null,
		errorMessage: null,
		id: "xhs_publish_task_1",
		media: [...createTaskInput.media],
		publishedAt: null,
		resultUrl: null,
		status: "created",
		title: createTaskInput.title,
		topics: [...createTaskInput.topics],
		updatedAt: now,
		userId,
		visibility: createTaskInput.visibility,
		...overrides,
	};
};

const asInjectedDatabase = (database: unknown): DatabaseParameter =>
	database as DatabaseParameter;

const isConflictUpdateConfig = (
	value: unknown
): value is ConflictUpdateConfig => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	return "set" in value && "target" in value;
};

const createFakeUpsertDatabase = () => {
	let conflictConfig: unknown;
	const database = {
		insert: (_table: unknown) => ({
			values: (_values: unknown) => ({
				onConflictDoUpdate: (config: unknown) => {
					conflictConfig = config;

					return {
						returning: (): Promise<[]> => Promise.resolve([]),
					};
				},
			}),
		}),
	};

	return {
		database: asInjectedDatabase(database),
		getConflictConfig: (): unknown => conflictConfig,
	};
};

const createFakeListTasksDatabase = (tasks: XiaohongshuPublishTaskRow[]) => {
	let queryLimit: number | null = null;
	const database = {
		select: () => ({
			from: (_table: unknown) => ({
				where: (_where: unknown) => ({
					orderBy: (_orderBy: unknown) => ({
						limit: (limit: number): Promise<XiaohongshuPublishTaskRow[]> => {
							queryLimit = limit;

							return Promise.resolve(tasks);
						},
					}),
				}),
			}),
		}),
	};

	return {
		database: asInjectedDatabase(database),
		getQueryLimit: (): number | null => queryLimit,
	};
};

const createFakeClaimTaskDatabase = (
	returnedTask: XiaohongshuPublishTaskRow | null
) => {
	let updateTable: unknown;
	let updateSet: Record<string, unknown> | null = null;
	let updateWhere: unknown;
	const database = {
		update: (table: unknown) => {
			updateTable = table;

			return {
				set: (set: Record<string, unknown>) => {
					updateSet = set;

					return {
						where: (where: unknown) => {
							updateWhere = where;

							return {
								returning: (): Promise<XiaohongshuPublishTaskRow[]> =>
									Promise.resolve(returnedTask ? [returnedTask] : []),
							};
						},
					};
				},
			};
		},
	};

	return {
		database: asInjectedDatabase(database),
		getUpdateSet: (): Record<string, unknown> | null => updateSet,
		getUpdateTable: (): unknown => updateTable,
		getUpdateWhere: (): unknown => updateWhere,
	};
};

const createFakeRejectingClaimTaskDatabase = (error: unknown) => {
	const database = {
		update: (_table: unknown) => ({
			set: (_set: unknown) => ({
				where: (_where: unknown) => ({
					returning: (): Promise<XiaohongshuPublishTaskRow[]> =>
						Promise.reject(error),
				}),
			}),
		}),
	};

	return {
		database: asInjectedDatabase(database),
	};
};

describe("memory Xiaohongshu publisher repository", () => {
	it("creates and reads a publish task with logs", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask(createTaskInput);

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

	it("claims a created task for publish only once and only for the owner", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask(createTaskInput);

		const claimed = await repository.claimTaskForPublish(userId, task.id);
		const secondClaim = await repository.claimTaskForPublish(userId, task.id);
		const otherUserClaim = await repository.claimTaskForPublish(
			"user-2",
			task.id
		);

		expect(claimed?.status).toBe("validating");
		expect(claimed?.updatedAt.getTime()).toBeGreaterThanOrEqual(
			task.updatedAt.getTime()
		);
		expect(secondClaim).toBeNull();
		expect(otherUserClaim).toBeNull();
	});

	it("claims only one active publish task per user", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const firstTask = await repository.createTask({
			...createTaskInput,
			title: "第一篇",
		});
		const secondTask = await repository.createTask({
			...createTaskInput,
			title: "第二篇",
		});
		const otherUserTask = await repository.createTask({
			...createTaskInput,
			title: "其他用户",
			userId: "user-2",
		});

		const firstClaim = await repository.claimTaskForPublish(
			userId,
			firstTask.id
		);
		const secondClaim = await repository.claimTaskForPublish(
			userId,
			secondTask.id
		);
		const otherUserClaim = await repository.claimTaskForPublish(
			"user-2",
			otherUserTask.id
		);

		expect(activeXiaohongshuPublishTaskStatuses).toContain("validating");
		expect(firstClaim?.status).toBe("validating");
		expect(secondClaim).toBeNull();
		expect(otherUserClaim?.status).toBe("validating");
	});

	it("updates task status and result", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask({
			...createTaskInput,
			topics: [],
		});

		await repository.updateTask(task.id, {
			resultUrl: "https://www.xiaohongshu.com/explore/demo",
			status: "succeeded",
		});

		const found = await repository.getTaskWithLogs(userId, task.id);

		expect(found?.task.status).toBe("succeeded");
		expect(found?.task.resultUrl).toContain("xiaohongshu.com");
	});

	it("upserts account config without replacing omitted optional fields", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const lastLoginAt = new Date("2026-01-01T00:00:00.000Z");
		const initial = await repository.upsertAccountConfig({
			displayName: "初始账号",
			lastLoginAt,
			profilePath: "/tmp/xhs-profile",
			status: "login_required",
			userId,
		});

		const updated = await repository.upsertAccountConfig({
			displayName: "更新账号",
			status: "ready",
			userId,
		});

		expect(updated.id).toBe(initial.id);
		expect(updated.createdAt.toISOString()).toBe(
			initial.createdAt.toISOString()
		);
		expect(updated.displayName).toBe("更新账号");
		expect(updated.lastLoginAt?.toISOString()).toBe(lastLoginAt.toISOString());
		expect(updated.profilePath).toBe("/tmp/xhs-profile");
		expect(updated.status).toBe("ready");
		expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
			initial.updatedAt.getTime()
		);
	});

	it("lists only the user's tasks newest first up to the limit", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		await repository.createTask({
			...createTaskInput,
			title: "最早标题",
		});
		const middleTask = await repository.createTask({
			...createTaskInput,
			title: "中间标题",
		});
		await repository.createTask({
			...createTaskInput,
			title: "其他用户标题",
			userId: "user-2",
		});
		const newerTask = await repository.createTask({
			...createTaskInput,
			title: "较新标题",
		});

		const tasks = await repository.listTasks(userId, 2);

		expect(tasks.map((task) => task.id)).toEqual([newerTask.id, middleTask.id]);
	});

	it("does not return task details for another user", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask(createTaskInput);

		const found = await repository.getTaskWithLogs("user-2", task.id);

		expect(found).toBeNull();
	});

	it("prevents returned task mutations from changing stored tasks", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask(createTaskInput);
		const [media] = task.media;
		if (!media) {
			throw new Error("Expected task to include media.");
		}

		task.topics.push("篡改话题");
		media.path = "/tmp/mutated.png";

		const found = await repository.getTaskWithLogs(userId, task.id);

		expect(found?.task.topics).toEqual(["咖啡"]);
		expect(found?.task.media[0]?.path).toBe("/tmp/cover.png");
	});

	it("prevents returned task details and logs from changing stored rows", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask(createTaskInput);
		await repository.addTaskLog({
			level: "info",
			message: "created",
			metadata: { source: "test" },
			step: "created",
			taskId: task.id,
		});

		const found = await repository.getTaskWithLogs(userId, task.id);
		if (!found) {
			throw new Error("Expected task details.");
		}
		const [media] = found.task.media;
		const [log] = found.logs;
		if (!(media && log)) {
			throw new Error("Expected task details to include media and a log.");
		}

		found.task.topics.push("篡改话题");
		media.path = "/tmp/mutated.png";
		log.metadata.extra = true;
		found.logs.push({ ...log, id: "injected-log" });

		const reread = await repository.getTaskWithLogs(userId, task.id);

		expect(reread?.task.topics).toEqual(["咖啡"]);
		expect(reread?.task.media[0]?.path).toBe("/tmp/cover.png");
		expect(reread?.logs).toHaveLength(1);
		expect(reread?.logs[0]?.metadata).toEqual({ source: "test" });
	});

	it("prevents returned account config mutations from changing stored config", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const lastLoginAt = new Date("2026-01-01T00:00:00.000Z");
		const config = await repository.upsertAccountConfig({
			displayName: "初始账号",
			lastLoginAt,
			status: "ready",
			userId,
		});

		config.displayName = "篡改账号";
		config.lastLoginAt?.setUTCFullYear(2030);

		const stored = await repository.getAccountConfig(userId);

		expect(stored?.displayName).toBe("初始账号");
		expect(stored?.lastLoginAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
	});

	it("prevents list task and added log return mutations from changing stored rows", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const task = await repository.createTask(createTaskInput);
		const log = await repository.addTaskLog({
			level: "info",
			message: "created",
			metadata: { source: "test" },
			step: "created",
			taskId: task.id,
		});

		const listedTasks = await repository.listTasks(userId, 1);
		const [listedTask] = listedTasks;
		const [listedMedia] = listedTask?.media ?? [];
		if (!(listedTask && listedMedia)) {
			throw new Error("Expected listed task to include media.");
		}
		listedTask.topics.push("篡改话题");
		listedMedia.path = "/tmp/mutated.png";
		log.metadata.extra = true;

		const reread = await repository.getTaskWithLogs(userId, task.id);

		expect(reread?.task.topics).toEqual(["咖啡"]);
		expect(reread?.task.media[0]?.path).toBe("/tmp/cover.png");
		expect(reread?.logs[0]?.metadata).toEqual({ source: "test" });
	});
});

describe("db Xiaohongshu publisher repository", () => {
	it("uses atomic account config upsert and throws on empty returning", async () => {
		const { database, getConflictConfig } = createFakeUpsertDatabase();
		const repository = createDbXiaohongshuPublisherRepository(database);

		await expect(repository.upsertAccountConfig({ userId })).rejects.toThrow(
			"Expected upsert account config to return a row."
		);

		const conflictConfig = getConflictConfig();
		expect(isConflictUpdateConfig(conflictConfig)).toBe(true);
		if (!isConflictUpdateConfig(conflictConfig)) {
			throw new Error("Expected onConflictDoUpdate config.");
		}
		expect(conflictConfig.target).toBe(xhsAccountConfig.userId);
	});

	it("passes the task list limit to the query builder", async () => {
		const { database, getQueryLimit } = createFakeListTasksDatabase([]);
		const repository = createDbXiaohongshuPublisherRepository(database);

		await repository.listTasks(userId, 2);

		expect(getQueryLimit()).toBe(2);
	});

	it("claims a task with a conditional update", async () => {
		const claimedTask = createTaskRow({ status: "validating" });
		const { database, getUpdateSet, getUpdateTable, getUpdateWhere } =
			createFakeClaimTaskDatabase(claimedTask);
		const repository = createDbXiaohongshuPublisherRepository(database);

		const claimed = await repository.claimTaskForPublish(
			userId,
			claimedTask.id
		);

		expect(claimed).toBe(claimedTask);
		expect(getUpdateTable()).toBe(xhsPublishTask);
		expect(getUpdateSet()).toEqual(
			expect.objectContaining({
				status: "validating",
				updatedAt: expect.any(Date),
			})
		);
		expect(getUpdateWhere()).toBeDefined();
	});

	it("returns null when the claim conditional update returns no rows", async () => {
		const { database } = createFakeClaimTaskDatabase(null);
		const repository = createDbXiaohongshuPublisherRepository(database);

		const claimed = await repository.claimTaskForPublish(
			userId,
			"xhs_publish_task_missing"
		);

		expect(claimed).toBeNull();
	});

	it("returns null when the active task unique index rejects a claim", async () => {
		const { database } = createFakeRejectingClaimTaskDatabase({
			code: "23505",
			constraint: "xhs_publish_task_active_user_unique",
		});
		const repository = createDbXiaohongshuPublisherRepository(database);

		const claimed = await repository.claimTaskForPublish(
			userId,
			"xhs_publish_task_2"
		);

		expect(claimed).toBeNull();
	});

	it("rethrows unexpected claim errors", async () => {
		const { database } = createFakeRejectingClaimTaskDatabase({
			code: "23505",
			constraint: "other_unique",
		});
		const repository = createDbXiaohongshuPublisherRepository(database);

		await expect(
			repository.claimTaskForPublish(userId, "xhs_publish_task_2")
		).rejects.toMatchObject({
			code: "23505",
			constraint: "other_unique",
		});
	});
});
