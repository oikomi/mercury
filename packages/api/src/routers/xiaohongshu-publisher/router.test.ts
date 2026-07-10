import type { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { router } from "../../index";
import { appRouter } from "../index";
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

const createTestRouter = () =>
	router({
		xiaohongshuPublisher: createXiaohongshuPublisherRouter(
			createXiaohongshuPublisherService({
				provider: createMockXiaohongshuPublishProvider(),
				repository: createMemoryXiaohongshuPublisherRepository(),
			})
		),
	});

describe("xiaohongshuPublisher router", () => {
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
	});

	it("is mounted on the application router", () => {
		expect("xiaohongshuPublisher" in appRouter._def.record).toBe(true);
	});
});
