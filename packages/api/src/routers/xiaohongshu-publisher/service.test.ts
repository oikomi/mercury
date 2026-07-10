import { describe, expect, it, vi } from "vitest";

import { createMemoryXiaohongshuPublisherRepository } from "./memory-repository";
import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import type { XiaohongshuPublishProvider } from "./provider";
import type { XiaohongshuPublisherRepository } from "./repository";
import type { CreatePublishTaskInput, XiaohongshuTaskStatus } from "./schema";
import { createXiaohongshuPublisherService } from "./service";

const userId = "user-1";

const createTaskInput: CreatePublishTaskInput = {
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
	topics: [" #探店 ", "", "咖啡", "#探店"],
	visibility: "public",
};

const publishWorkflowSteps = [
	"created",
	"validating",
	"opening_browser",
	"checking_login",
	"uploading_media",
	"filling_form",
	"submitting",
	"verifying_result",
] as const;

const createDeferred = <Value>() => {
	let resolve: (value: Value) => void = () => {
		throw new Error("Deferred promise resolved before initialization.");
	};
	const promise = new Promise<Value>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return {
		promise,
		resolve,
	};
};

const createService = (
	options: {
		provider?: XiaohongshuPublishProvider;
		repository?: XiaohongshuPublisherRepository;
	} = {}
) => {
	const repository =
		options.repository ?? createMemoryXiaohongshuPublisherRepository();
	const provider = options.provider ?? createMockXiaohongshuPublishProvider();
	const service = createXiaohongshuPublisherService({
		provider,
		repository,
	});

	return {
		provider,
		repository,
		service,
	};
};

describe("Xiaohongshu publisher service", () => {
	it("creates and publishes a successful task", async () => {
		const { repository, service } = createService();
		const task = await service.createTask(userId, createTaskInput);

		expect(task.status).toBe("created");
		expect(task.topics).toEqual(["探店", "咖啡"]);

		const published = await service.publishTask(userId, task.id);

		expect(published.status).toBe("succeeded");
		expect(published.resultUrl).toContain("xiaohongshu.com");
		expect(published.publishedAt).toBeInstanceOf(Date);

		const details = await repository.getTaskWithLogs(userId, task.id);

		expect(details?.logs.map((log) => log.step)).toEqual([
			...publishWorkflowSteps,
			"succeeded",
		]);
		expect(details?.logs.at(-1)).toEqual(
			expect.objectContaining({
				level: "info",
				metadata: expect.objectContaining({
					resultUrl: published.resultUrl,
				}),
				step: "succeeded",
			})
		);
	});

	it("records provider failures with task logs", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockResolvedValue({
				debugScreenshotPath: "/tmp/xhs-failed.png",
				errorCode: "mock_provider_failed",
				errorMessage: "Mock Xiaohongshu provider failed by request.",
				status: "failed",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);

		const published = await service.publishTask(userId, task.id);

		expect(provider.publish).toHaveBeenCalledWith({
			content: task.content,
			media: task.media,
			taskId: task.id,
			title: task.title,
			topics: task.topics,
			visibility: task.visibility,
		});
		expect(published).toEqual(
			expect.objectContaining({
				debugScreenshotPath: "/tmp/xhs-failed.png",
				errorCode: "mock_provider_failed",
				errorMessage: "Mock Xiaohongshu provider failed by request.",
				publishedAt: null,
				resultUrl: null,
				status: "failed",
			})
		);

		const details = await repository.getTaskWithLogs(userId, task.id);

		expect(details?.logs.at(-1)).toEqual(
			expect.objectContaining({
				level: "error",
				metadata: expect.objectContaining({
					debugScreenshotPath: "/tmp/xhs-failed.png",
					errorCode: "mock_provider_failed",
				}),
				step: "failed",
			})
		);
	});

	it("clears stale terminal fields when recording provider failures", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockResolvedValue({
				errorCode: "mock_provider_failed",
				errorMessage: "Mock Xiaohongshu provider failed by request.",
				status: "failed",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const updateTask = vi.spyOn(repository, "updateTask");
		const task = await service.createTask(userId, createTaskInput);

		const published = await service.publishTask(userId, task.id);

		expect(published.resultUrl).toBeNull();
		expect(published.publishedAt).toBeNull();
		expect(updateTask).toHaveBeenCalledWith(
			task.id,
			expect.objectContaining({
				publishedAt: null,
				resultUrl: null,
				status: "failed",
			})
		);
	});

	it("maps submitted_unknown provider results to task status and an error log", async () => {
		const { repository, service } = createService({
			provider: createMockXiaohongshuPublishProvider({
				mode: "submitted_unknown",
			}),
		});
		const task = await service.createTask(userId, createTaskInput);

		const published = await service.publishTask(userId, task.id);

		expect(published.status).toBe("submitted_unknown");
		expect(published.errorCode).toBe("submitted_unknown");
		expect(published.debugScreenshotPath).toBeNull();
		expect(published.resultUrl).toBeNull();
		expect(published.publishedAt).toBeNull();

		const details = await repository.getTaskWithLogs(userId, task.id);

		expect(details?.logs.at(-1)).toEqual(
			expect.objectContaining({
				level: "error",
				metadata: expect.objectContaining({
					errorCode: "submitted_unknown",
				}),
				step: "submitted_unknown",
			})
		);
	});

	it("records submitted_unknown debug screenshots on the task and log metadata", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockResolvedValue({
				debugScreenshotPath: "/tmp/xhs-submitted-unknown.png",
				errorCode: "submitted_unknown",
				errorMessage:
					"Mock Xiaohongshu provider submitted the note but could not verify the result.",
				status: "submitted_unknown",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);

		const published = await service.publishTask(userId, task.id);

		expect(published).toEqual(
			expect.objectContaining({
				debugScreenshotPath: "/tmp/xhs-submitted-unknown.png",
				status: "submitted_unknown",
			})
		);

		const details = await repository.getTaskWithLogs(userId, task.id);

		expect(details?.logs.at(-1)?.metadata).toEqual(
			expect.objectContaining({
				debugScreenshotPath: "/tmp/xhs-submitted-unknown.png",
				errorCode: "submitted_unknown",
			})
		);
	});

	it("throws for a missing or other-user publish task", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn(),
		} satisfies XiaohongshuPublishProvider;
		const { service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);

		await expect(service.publishTask(userId, "missing-task")).rejects.toThrow(
			"Publish task not found."
		);
		await expect(service.publishTask("user-2", task.id)).rejects.toThrow(
			"Publish task not found."
		);
		expect(provider.publish).not.toHaveBeenCalled();
	});

	it("prevents a task from being published more than once", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockResolvedValue({
				publishedAt: new Date("2026-01-01T00:00:00.000Z"),
				resultUrl: "https://www.xiaohongshu.com/explore/once",
				status: "succeeded",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);

		await service.publishTask(userId, task.id);
		await expect(service.publishTask(userId, task.id)).rejects.toThrow(
			"Publish task is not in a publishable state."
		);

		expect(provider.publish).toHaveBeenCalledTimes(1);
	});

	it("atomically claims a task so concurrent publishes call the provider once", async () => {
		const publishResult =
			createDeferred<
				Awaited<ReturnType<XiaohongshuPublishProvider["publish"]>>
			>();
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockReturnValue(publishResult.promise),
		} satisfies XiaohongshuPublishProvider;
		const { service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);

		const firstPublish = service.publishTask(userId, task.id);
		const secondPublish = service.publishTask(userId, task.id);
		const settledPublishes = Promise.allSettled([firstPublish, secondPublish]);
		await vi.waitFor(() => {
			expect(provider.publish).toHaveBeenCalledTimes(1);
		});
		publishResult.resolve({
			publishedAt: new Date("2026-01-01T00:00:00.000Z"),
			resultUrl: "https://www.xiaohongshu.com/explore/concurrent",
			status: "succeeded",
		});

		const results = await settledPublishes;

		expect(results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "fulfilled",
					value: expect.objectContaining({
						status: "succeeded",
					}),
				}),
				expect.objectContaining({
					reason: expect.objectContaining({
						message: "Publish task is not in a publishable state.",
					}),
					status: "rejected",
				}),
			])
		);
		expect(provider.publish).toHaveBeenCalledTimes(1);
	});

	it("allows only one active publish task per user", async () => {
		const publishResult =
			createDeferred<
				Awaited<ReturnType<XiaohongshuPublishProvider["publish"]>>
			>();
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockReturnValue(publishResult.promise),
		} satisfies XiaohongshuPublishProvider;
		const { service } = createService({ provider });
		const firstTask = await service.createTask(userId, {
			...createTaskInput,
			title: "第一篇",
		});
		const secondTask = await service.createTask(userId, {
			...createTaskInput,
			title: "第二篇",
		});

		const firstPublish = service.publishTask(userId, firstTask.id);
		await vi.waitFor(() => {
			expect(provider.publish).toHaveBeenCalledTimes(1);
		});

		await expect(service.publishTask(userId, secondTask.id)).rejects.toThrow(
			"Publish task is not in a publishable state."
		);
		expect(provider.publish).toHaveBeenCalledTimes(1);

		publishResult.resolve({
			publishedAt: new Date("2026-01-01T00:00:00.000Z"),
			resultUrl: "https://www.xiaohongshu.com/explore/active",
			status: "succeeded",
		});
		await expect(firstPublish).resolves.toEqual(
			expect.objectContaining({
				status: "succeeded",
			})
		);
	});

	it.each([
		"submitting",
		"failed",
	] satisfies XiaohongshuTaskStatus[])("prevents %s tasks from entering the publish workflow", async (status) => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn(),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);
		await repository.updateTask(task.id, { status });

		await expect(service.publishTask(userId, task.id)).rejects.toThrow(
			"Publish task is not in a publishable state."
		);

		expect(provider.publish).not.toHaveBeenCalled();
	});

	it("records provider rejections as failed tasks with an error log", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockRejectedValue(new Error("Browser context closed.")),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const task = await service.createTask(userId, createTaskInput);

		const published = await service.publishTask(userId, task.id);

		expect(published).toEqual(
			expect.objectContaining({
				debugScreenshotPath: null,
				errorCode: "provider_error",
				errorMessage: "Provider failed: Browser context closed.",
				publishedAt: null,
				resultUrl: null,
				status: "failed",
			})
		);

		const details = await repository.getTaskWithLogs(userId, task.id);

		expect(details?.task.status).toBe("failed");
		expect(details?.logs.at(-1)).toEqual(
			expect.objectContaining({
				level: "error",
				metadata: expect.objectContaining({
					errorCode: "provider_error",
				}),
				step: "failed",
			})
		);
	});

	it("releases the active publish slot when workflow logging fails after claim", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockResolvedValue({
				publishedAt: new Date("2026-01-01T00:00:00.000Z"),
				resultUrl: "https://www.xiaohongshu.com/explore/after-log-failure",
				status: "succeeded",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const originalAddTaskLog = repository.addTaskLog;
		const addTaskLog = vi.spyOn(repository, "addTaskLog");
		let shouldFailValidatingLog = true;
		addTaskLog.mockImplementation((input) => {
			if (shouldFailValidatingLog && input.step === "validating") {
				shouldFailValidatingLog = false;

				return Promise.reject(new Error("Failed to write validating log."));
			}

			return originalAddTaskLog(input);
		});
		const firstTask = await service.createTask(userId, {
			...createTaskInput,
			title: "日志失败",
		});

		const failedTask = await service.publishTask(userId, firstTask.id);

		expect(provider.publish).not.toHaveBeenCalled();
		expect(failedTask).toEqual(
			expect.objectContaining({
				debugScreenshotPath: null,
				errorCode: "provider_error",
				errorMessage: "Provider failed: Failed to write validating log.",
				publishedAt: null,
				resultUrl: null,
				status: "failed",
			})
		);

		const secondTask = await service.createTask(userId, {
			...createTaskInput,
			title: "后续发布",
		});
		const publishedTask = await service.publishTask(userId, secondTask.id);

		expect(publishedTask.status).toBe("succeeded");
		expect(provider.publish).toHaveBeenCalledTimes(1);
	});

	it("releases the active publish slot when workflow status updates fail after claim", async () => {
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn().mockResolvedValue({
				publishedAt: new Date("2026-01-01T00:00:00.000Z"),
				resultUrl: "https://www.xiaohongshu.com/explore/after-status-failure",
				status: "succeeded",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { repository, service } = createService({ provider });
		const originalUpdateTask = repository.updateTask;
		const updateTask = vi.spyOn(repository, "updateTask");
		let shouldFailOpeningBrowser = true;
		updateTask.mockImplementation((taskId, input) => {
			if (shouldFailOpeningBrowser && input.status === "opening_browser") {
				shouldFailOpeningBrowser = false;

				return Promise.reject(new Error("Failed to update workflow status."));
			}

			return originalUpdateTask(taskId, input);
		});
		const firstTask = await service.createTask(userId, {
			...createTaskInput,
			title: "状态失败",
		});

		const failedTask = await service.publishTask(userId, firstTask.id);

		expect(provider.publish).not.toHaveBeenCalled();
		expect(failedTask).toEqual(
			expect.objectContaining({
				debugScreenshotPath: null,
				errorCode: "provider_error",
				errorMessage: "Provider failed: Failed to update workflow status.",
				publishedAt: null,
				resultUrl: null,
				status: "failed",
			})
		);

		const secondTask = await service.createTask(userId, {
			...createTaskInput,
			title: "状态失败后续发布",
		});
		const publishedTask = await service.publishTask(userId, secondTask.id);

		expect(publishedTask.status).toBe("succeeded");
		expect(provider.publish).toHaveBeenCalledTimes(1);
	});

	it("checks provider account status once and returns existing config without clobbering optional fields", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const provider = {
			checkSession: vi.fn().mockResolvedValue({
				displayName: "Mock Xiaohongshu",
				profilePath: "/tmp/mercury-xhs-profile",
				status: "ready",
			}),
			publish: vi.fn(),
		} satisfies XiaohongshuPublishProvider;
		const service = createXiaohongshuPublisherService({
			provider,
			repository,
		});

		const firstStatus = await service.getAccountStatus(userId);
		const lastLoginAt = new Date("2026-01-01T00:00:00.000Z");
		await repository.upsertAccountConfig({
			lastLoginAt,
			userId,
		});

		const secondStatus = await service.getAccountStatus(userId);

		expect(firstStatus).toEqual(
			expect.objectContaining({
				displayName: "Mock Xiaohongshu",
				profilePath: "/tmp/mercury-xhs-profile",
				status: "ready",
				userId,
			})
		);
		expect(firstStatus.lastCheckedAt).toBeInstanceOf(Date);
		expect(provider.checkSession).toHaveBeenCalledTimes(1);
		expect(secondStatus.id).toBe(firstStatus.id);
		expect(secondStatus.displayName).toBe("Mock Xiaohongshu");
		expect(secondStatus.lastLoginAt?.toISOString()).toBe(
			lastLoginAt.toISOString()
		);
	});

	it("refreshes a cached account status through the provider", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const provider = {
			checkSession: vi
				.fn()
				.mockResolvedValueOnce({
					displayName: null,
					profilePath: "/tmp/mercury-xhs-profile",
					status: "login_required",
				})
				.mockResolvedValueOnce({
					displayName: "已登录账号",
					profilePath: "/tmp/mercury-xhs-profile",
					status: "ready",
				}),
			publish: vi.fn(),
			startLogin: vi.fn(),
		} satisfies XiaohongshuPublishProvider;
		const service = createXiaohongshuPublisherService({ provider, repository });

		await service.getAccountStatus(userId);
		const refreshed = await service.refreshAccountStatus(userId);

		expect(provider.checkSession).toHaveBeenCalledTimes(2);
		expect(refreshed).toEqual(
			expect.objectContaining({
				displayName: "已登录账号",
				status: "ready",
				userId,
			})
		);
	});

	it("starts interactive login and records the successful login time", async () => {
		const loginCompletedAt = new Date("2026-07-10T08:00:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(loginCompletedAt);
		const provider = {
			checkSession: vi.fn(),
			publish: vi.fn(),
			startLogin: vi.fn().mockResolvedValue({
				displayName: "已登录账号",
				profilePath: "/tmp/mercury-xhs-profile",
				status: "ready",
			}),
		} satisfies XiaohongshuPublishProvider;
		const { service } = createService({ provider });

		try {
			const status = await service.startLogin(userId);

			expect(provider.startLogin).toHaveBeenCalledOnce();
			expect(status.status).toBe("ready");
			expect(status.lastLoginAt?.toISOString()).toBe(
				loginCompletedAt.toISOString()
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("delegates list limits and returns limited repository results", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const listTasks = vi.spyOn(repository, "listTasks");
		const service = createXiaohongshuPublisherService({
			provider: createMockXiaohongshuPublishProvider(),
			repository,
		});
		await service.createTask(userId, {
			...createTaskInput,
			title: "最早标题",
		});
		const middleTask = await service.createTask(userId, {
			...createTaskInput,
			title: "中间标题",
		});
		const newerTask = await service.createTask(userId, {
			...createTaskInput,
			title: "较新标题",
		});

		const tasks = await service.listTasks(userId, 2);

		expect(listTasks).toHaveBeenCalledWith(userId, 2);
		expect(tasks.map((task) => task.id)).toEqual([newerTask.id, middleTask.id]);
	});

	it("records a failed task when an active workflow update returns null", async () => {
		const repository = createMemoryXiaohongshuPublisherRepository();
		const updateTask = vi.spyOn(repository, "updateTask");
		updateTask.mockResolvedValueOnce(null);
		const service = createXiaohongshuPublisherService({
			provider: createMockXiaohongshuPublishProvider(),
			repository,
		});
		const task = await service.createTask(userId, createTaskInput);

		await expect(service.publishTask(userId, task.id)).resolves.toEqual(
			expect.objectContaining({
				debugScreenshotPath: null,
				errorCode: "provider_error",
				errorMessage:
					"Provider failed: Expected publish task update to return a row.",
				publishedAt: null,
				resultUrl: null,
				status: "failed",
			})
		);
	});
});
