import type { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { router } from "../../index";
import { appRouter } from "../index";
import type { XiaohongshuAiDraftGenerator } from "./ai-draft";
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

	it("generates a screenshot draft for an authenticated user", async () => {
		const caller = createTestRouter().createCaller({
			auth: null,
			session,
		});
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
		});
	});

	it("creates, publishes, and reads a task for an authenticated user", async () => {
		const caller = createTestRouter().createCaller({
			auth: null,
			session,
		});

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

	it("rejects anonymous access", async () => {
		const caller = createTestRouter().createCaller({
			auth: null,
			session: null,
		});

		await expect(
			caller.xiaohongshuPublisher.listTasks({ limit: 5 })
		).rejects.toEqual(
			expect.objectContaining<Partial<TRPCError>>({ code: "UNAUTHORIZED" })
		);
		const publisher =
			caller.xiaohongshuPublisher as typeof caller.xiaohongshuPublisher & {
				generateDraft?: (input: { imageDataUrl: string }) => Promise<unknown>;
			};
		expect(publisher.generateDraft).toBeTypeOf("function");
		if (!publisher.generateDraft) {
			return;
		}
		await expect(
			publisher.generateDraft({ imageDataUrl: PNG_DATA_URL })
		).rejects.toEqual(
			expect.objectContaining<Partial<TRPCError>>({ code: "UNAUTHORIZED" })
		);
	});

	it("refreshes account status and starts interactive login", async () => {
		const caller = createTestRouter().createCaller({
			auth: null,
			session,
		});

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
