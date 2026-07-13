import { beforeEach, describe, expect, it, vi } from "vitest";

import { router } from "../../index";
import { appRouter } from "../index";
import type { XiaohongshuAiDraftGenerator } from "./ai-draft";
import { createMemoryXiaohongshuPublisherRepository } from "./memory-repository";
import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import { createXiaohongshuPublisherRouter } from "./router";
import { createXiaohongshuPublisherService } from "./service";

const PNG_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const generateDraft = vi.fn(async () => ({
	content: "生成正文",
	mediaPath: "/tmp/generated.png",
	title: "生成标题",
	topics: ["截图"],
}));
const aiDraftGenerator: XiaohongshuAiDraftGenerator = {
	generate: generateDraft,
};

const createTestRouter = () =>
	router({
		xiaohongshuPublisher: createXiaohongshuPublisherRouter(
			createXiaohongshuPublisherService({
				provider: createMockXiaohongshuPublishProvider(),
				repository: createMemoryXiaohongshuPublisherRepository(),
			}),
			aiDraftGenerator
		),
	});

describe("xiaohongshuPublisher router", () => {
	beforeEach(() => {
		generateDraft.mockClear();
	});

	it("generates a screenshot draft", async () => {
		const caller = createTestRouter().createCaller({});
		const publisher =
			caller.xiaohongshuPublisher as typeof caller.xiaohongshuPublisher & {
				generateDraft?: (input: {
					imageDataUrl: string;
					intent?: string;
				}) => Promise<{
					mediaPath: string;
				}>;
			};

		expect(publisher.generateDraft).toBeTypeOf("function");
		if (!publisher.generateDraft) {
			return;
		}

		const draft = await publisher.generateDraft({
			imageDataUrl: PNG_DATA_URL,
			intent: "轻松一点",
		});

		expect(draft.mediaPath).toBe("/tmp/generated.png");
		expect(generateDraft).toHaveBeenCalledWith({
			imageDataUrl: PNG_DATA_URL,
			intent: "轻松一点",
			style: "auto",
		});
	});

	it("creates, publishes, and reads a task", async () => {
		const caller = createTestRouter().createCaller({});

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

	it("shares one local publishing workspace", async () => {
		const testRouter = createTestRouter();
		const firstCaller = testRouter.createCaller({});
		const secondCaller = testRouter.createCaller({});
		const task = await firstCaller.xiaohongshuPublisher.createTask({
			content: "共享正文",
			media: [
				{
					mimeType: "image/png",
					name: "shared.png",
					path: "/tmp/shared.png",
					size: 100,
					type: "image",
				},
			],
			title: "共享任务",
			topics: [],
			visibility: "private",
		});

		const tasks = await secondCaller.xiaohongshuPublisher.listTasks({
			limit: 5,
		});

		expect(tasks.map(({ id }) => id)).toContain(task.id);
	});

	it("refreshes account status and starts interactive login", async () => {
		const caller = createTestRouter().createCaller({});

		const refreshed = await caller.xiaohongshuPublisher.refreshAccountStatus();
		const loggedIn = await caller.xiaohongshuPublisher.startLogin();

		expect(refreshed.status).toBe("ready");
		expect(loggedIn.status).toBe("ready");
		expect(loggedIn.lastLoginAt).toBeInstanceOf(Date);
	});

	it("is mounted on the application router", () => {
		expect("xiaohongshuPublisher" in appRouter._def.record).toBe(true);
	});
});
