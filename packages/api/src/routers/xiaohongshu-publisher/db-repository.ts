import { db as defaultDb } from "@mercury/db";
import {
	xhsAccountConfig,
	xhsPublishTask,
	xhsPublishTaskLog,
} from "@mercury/db/schema/xiaohongshu-publisher";
import { and, asc, desc, eq } from "drizzle-orm";

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

type XiaohongshuDatabase = typeof defaultDb;

const requireReturnedRow = <Row>(row: Row | undefined, action: string): Row => {
	if (!row) {
		throw new Error(`Expected ${action} to return a row.`);
	}

	return row;
};

const accountConfigInsertValues = (
	input: UpsertAccountConfigInput
): typeof xhsAccountConfig.$inferInsert => {
	const values: typeof xhsAccountConfig.$inferInsert = {
		id: createId("xhs_account_config"),
		userId: input.userId,
	};

	if (input.displayName !== undefined) {
		values.displayName = input.displayName;
	}
	if (input.lastCheckedAt !== undefined) {
		values.lastCheckedAt = input.lastCheckedAt;
	}
	if (input.lastLoginAt !== undefined) {
		values.lastLoginAt = input.lastLoginAt;
	}
	if (input.profilePath !== undefined) {
		values.profilePath = input.profilePath;
	}
	if (input.status !== undefined) {
		values.status = input.status;
	}

	return values;
};

const accountConfigUpdateSet = (
	input: UpsertAccountConfigInput
): Partial<typeof xhsAccountConfig.$inferInsert> => {
	const set: Partial<typeof xhsAccountConfig.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (input.displayName !== undefined) {
		set.displayName = input.displayName;
	}
	if (input.lastCheckedAt !== undefined) {
		set.lastCheckedAt = input.lastCheckedAt;
	}
	if (input.lastLoginAt !== undefined) {
		set.lastLoginAt = input.lastLoginAt;
	}
	if (input.profilePath !== undefined) {
		set.profilePath = input.profilePath;
	}
	if (input.status !== undefined) {
		set.status = input.status;
	}

	return set;
};

const taskUpdateSet = (
	input: UpdateTaskInput
): Partial<typeof xhsPublishTask.$inferInsert> => {
	const set: Partial<typeof xhsPublishTask.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (input.debugScreenshotPath !== undefined) {
		set.debugScreenshotPath = input.debugScreenshotPath;
	}
	if (input.errorCode !== undefined) {
		set.errorCode = input.errorCode;
	}
	if (input.errorMessage !== undefined) {
		set.errorMessage = input.errorMessage;
	}
	if (input.publishedAt !== undefined) {
		set.publishedAt = input.publishedAt;
	}
	if (input.resultUrl !== undefined) {
		set.resultUrl = input.resultUrl;
	}
	if (input.status !== undefined) {
		set.status = input.status;
	}

	return set;
};

export function createDbXiaohongshuPublisherRepository(
	database: XiaohongshuDatabase = defaultDb
): XiaohongshuPublisherRepository {
	return {
		async addTaskLog(
			input: AddTaskLogInput
		): Promise<XiaohongshuPublishTaskLogRow> {
			const values: typeof xhsPublishTaskLog.$inferInsert = {
				id: createId("xhs_publish_task_log"),
				level: input.level,
				message: input.message,
				metadata: input.metadata,
				step: input.step,
				taskId: input.taskId,
			};
			const [log] = await database
				.insert(xhsPublishTaskLog)
				.values(values)
				.returning();

			return requireReturnedRow(log, "add task log");
		},

		async createTask(
			input: CreateTaskRepositoryInput
		): Promise<XiaohongshuPublishTaskRow> {
			const values: typeof xhsPublishTask.$inferInsert = {
				content: input.content,
				id: createId("xhs_publish_task"),
				media: [...input.media],
				title: input.title,
				topics: [...input.topics],
				userId: input.userId,
				visibility: input.visibility,
			};
			const [task] = await database
				.insert(xhsPublishTask)
				.values(values)
				.returning();

			return requireReturnedRow(task, "create task");
		},

		async getAccountConfig(
			userId: string
		): Promise<XiaohongshuAccountConfigRow | null> {
			const [config] = await database
				.select()
				.from(xhsAccountConfig)
				.where(eq(xhsAccountConfig.userId, userId))
				.limit(1);

			return config ?? null;
		},

		async getTaskWithLogs(
			userId: string,
			taskId: string
		): Promise<{
			logs: XiaohongshuPublishTaskLogRow[];
			task: XiaohongshuPublishTaskRow;
		} | null> {
			const [task] = await database
				.select()
				.from(xhsPublishTask)
				.where(
					and(eq(xhsPublishTask.id, taskId), eq(xhsPublishTask.userId, userId))
				)
				.limit(1);

			if (!task) {
				return null;
			}

			const logs = await database
				.select()
				.from(xhsPublishTaskLog)
				.where(eq(xhsPublishTaskLog.taskId, taskId))
				.orderBy(asc(xhsPublishTaskLog.createdAt));

			return {
				logs,
				task,
			};
		},

		async listTasks(
			userId: string,
			limit: number
		): Promise<XiaohongshuPublishTaskRow[]> {
			const tasks = await database
				.select()
				.from(xhsPublishTask)
				.where(eq(xhsPublishTask.userId, userId))
				.orderBy(desc(xhsPublishTask.createdAt))
				.limit(limit);

			return tasks;
		},

		async updateTask(
			taskId: string,
			input: UpdateTaskInput
		): Promise<XiaohongshuPublishTaskRow | null> {
			const [task] = await database
				.update(xhsPublishTask)
				.set(taskUpdateSet(input))
				.where(eq(xhsPublishTask.id, taskId))
				.returning();

			return task ?? null;
		},

		async upsertAccountConfig(
			input: UpsertAccountConfigInput
		): Promise<XiaohongshuAccountConfigRow> {
			const [config] = await database
				.insert(xhsAccountConfig)
				.values(accountConfigInsertValues(input))
				.onConflictDoUpdate({
					set: accountConfigUpdateSet(input),
					target: xhsAccountConfig.userId,
				})
				.returning();

			return requireReturnedRow(config, "upsert account config");
		},
	};
}
