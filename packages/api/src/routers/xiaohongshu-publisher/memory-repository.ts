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

const cloneDate = (date: Date): Date => new Date(date.getTime());

const cloneNullableDate = (date: Date | null): Date | null =>
	date ? cloneDate(date) : null;

const cloneUnknownValue = (value: unknown): unknown => {
	if (value instanceof Date) {
		return cloneDate(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => cloneUnknownValue(item));
	}

	if (typeof value === "object" && value !== null) {
		const cloned: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			cloned[key] = cloneUnknownValue(item);
		}

		return cloned;
	}

	return value;
};

const cloneMetadata = (
	metadata: Record<string, unknown>
): Record<string, unknown> => {
	if (typeof globalThis.structuredClone === "function") {
		return globalThis.structuredClone(metadata);
	}

	return cloneUnknownValue(metadata) as Record<string, unknown>;
};

const cloneMedia = (
	media: readonly XiaohongshuPublishTaskRow["media"][number][]
): XiaohongshuPublishTaskRow["media"] =>
	media.map((item) => ({
		...item,
	}));

const cloneTopics = (
	topics: readonly XiaohongshuPublishTaskRow["topics"][number][]
): XiaohongshuPublishTaskRow["topics"] => [...topics];

const cloneAccountConfig = (
	config: XiaohongshuAccountConfigRow
): XiaohongshuAccountConfigRow => ({
	...config,
	createdAt: cloneDate(config.createdAt),
	lastCheckedAt: cloneNullableDate(config.lastCheckedAt),
	lastLoginAt: cloneNullableDate(config.lastLoginAt),
	updatedAt: cloneDate(config.updatedAt),
});

const cloneTask = (
	task: XiaohongshuPublishTaskRow
): XiaohongshuPublishTaskRow => ({
	...task,
	createdAt: cloneDate(task.createdAt),
	media: cloneMedia(task.media),
	publishedAt: cloneNullableDate(task.publishedAt),
	topics: cloneTopics(task.topics),
	updatedAt: cloneDate(task.updatedAt),
});

const cloneLog = (
	log: XiaohongshuPublishTaskLogRow
): XiaohongshuPublishTaskLogRow => ({
	...log,
	createdAt: cloneDate(log.createdAt),
	metadata: cloneMetadata(log.metadata),
});

export function createMemoryXiaohongshuPublisherRepository(): XiaohongshuPublisherRepository {
	const accountConfigsByUserId = new Map<string, XiaohongshuAccountConfigRow>();
	const taskLogsByTaskId = new Map<string, XiaohongshuPublishTaskLogRow[]>();
	const tasksById = new Map<string, XiaohongshuPublishTaskRow>();
	let latestTimestamp = 0;

	const createTimestamp = (): Date => {
		const currentTimestamp = Date.now();
		latestTimestamp =
			currentTimestamp <= latestTimestamp
				? latestTimestamp + 1
				: currentTimestamp;

		return new Date(latestTimestamp);
	};

	return {
		addTaskLog: (
			input: AddTaskLogInput
		): Promise<XiaohongshuPublishTaskLogRow> => {
			const log: XiaohongshuPublishTaskLogRow = {
				createdAt: createTimestamp(),
				id: createId("xhs_publish_task_log"),
				level: input.level,
				message: input.message,
				metadata: cloneMetadata(input.metadata),
				step: input.step,
				taskId: input.taskId,
			};
			const logs = taskLogsByTaskId.get(input.taskId) ?? [];
			taskLogsByTaskId.set(input.taskId, [...logs, log]);

			return Promise.resolve(cloneLog(log));
		},

		createTask: (
			input: CreateTaskRepositoryInput
		): Promise<XiaohongshuPublishTaskRow> => {
			const now = createTimestamp();
			const task: XiaohongshuPublishTaskRow = {
				content: input.content,
				createdAt: now,
				debugScreenshotPath: null,
				errorCode: null,
				errorMessage: null,
				id: createId("xhs_publish_task"),
				media: cloneMedia(input.media),
				publishedAt: null,
				resultUrl: null,
				status: "created",
				title: input.title,
				topics: cloneTopics(input.topics),
				updatedAt: now,
				userId: input.userId,
				visibility: input.visibility,
			};
			tasksById.set(task.id, task);

			return Promise.resolve(cloneTask(task));
		},

		getAccountConfig: (
			userId: string
		): Promise<XiaohongshuAccountConfigRow | null> => {
			const config = accountConfigsByUserId.get(userId);

			return Promise.resolve(config ? cloneAccountConfig(config) : null);
		},

		getTaskWithLogs: (
			userId: string,
			taskId: string
		): Promise<{
			logs: XiaohongshuPublishTaskLogRow[];
			task: XiaohongshuPublishTaskRow;
		} | null> => {
			const task = tasksById.get(taskId);
			if (!task || task.userId !== userId) {
				return Promise.resolve(null);
			}

			return Promise.resolve({
				logs: (taskLogsByTaskId.get(taskId) ?? []).map((log) => cloneLog(log)),
				task: cloneTask(task),
			});
		},

		listTasks: (
			userId: string,
			limit: number
		): Promise<XiaohongshuPublishTaskRow[]> => {
			const tasks = [...tasksById.values()]
				.filter((task) => task.userId === userId)
				.sort(
					(left, right) => right.createdAt.getTime() - left.createdAt.getTime()
				)
				.slice(0, limit);

			return Promise.resolve(tasks.map((task) => cloneTask(task)));
		},

		updateTask: (
			taskId: string,
			input: UpdateTaskInput
		): Promise<XiaohongshuPublishTaskRow | null> => {
			const existing = tasksById.get(taskId);
			if (!existing) {
				return Promise.resolve(null);
			}

			const now = createTimestamp();
			const updated: XiaohongshuPublishTaskRow = {
				...existing,
				updatedAt: now,
			};

			if (input.debugScreenshotPath !== undefined) {
				updated.debugScreenshotPath = input.debugScreenshotPath;
			}
			if (input.errorCode !== undefined) {
				updated.errorCode = input.errorCode;
			}
			if (input.errorMessage !== undefined) {
				updated.errorMessage = input.errorMessage;
			}
			if (input.publishedAt !== undefined) {
				updated.publishedAt = cloneNullableDate(input.publishedAt);
			}
			if (input.resultUrl !== undefined) {
				updated.resultUrl = input.resultUrl;
			}
			if (input.status !== undefined) {
				updated.status = input.status;
			}

			tasksById.set(taskId, updated);

			return Promise.resolve(cloneTask(updated));
		},

		upsertAccountConfig: (
			input: UpsertAccountConfigInput
		): Promise<XiaohongshuAccountConfigRow> => {
			const existing = accountConfigsByUserId.get(input.userId);
			const now = createTimestamp();
			const config: XiaohongshuAccountConfigRow = existing
				? {
						...existing,
						updatedAt: now,
					}
				: {
						createdAt: now,
						displayName: null,
						id: createId("xhs_account_config"),
						lastCheckedAt: null,
						lastLoginAt: null,
						profilePath: null,
						status: "not_configured",
						updatedAt: now,
						userId: input.userId,
					};

			if (input.displayName !== undefined) {
				config.displayName = input.displayName;
			}
			if (input.lastCheckedAt !== undefined) {
				config.lastCheckedAt = cloneNullableDate(input.lastCheckedAt);
			}
			if (input.lastLoginAt !== undefined) {
				config.lastLoginAt = cloneNullableDate(input.lastLoginAt);
			}
			if (input.profilePath !== undefined) {
				config.profilePath = input.profilePath;
			}
			if (input.status !== undefined) {
				config.status = input.status;
			}

			accountConfigsByUserId.set(input.userId, config);

			return Promise.resolve(cloneAccountConfig(config));
		},
	};
}
