// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import XiaohongshuPublisher from "./xiaohongshu-publisher";

const { invalidateQueries } = vi.hoisted(() => ({
	invalidateQueries: vi.fn(async () => undefined),
}));

vi.mock("@/utils/trpc", () => {
	const createdTask = {
		content: "今天的咖啡很好喝",
		createdAt: new Date(),
		debugScreenshotPath: null,
		errorCode: null,
		errorMessage: null,
		id: "task-1",
		media: [],
		publishedAt: null,
		resultUrl: null,
		status: "created",
		title: "探店笔记",
		topics: [],
		updatedAt: new Date(),
		userId: "user-1",
		visibility: "public",
	};

	return {
		queryClient: { invalidateQueries },
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
							publishedAt: new Date(),
							resultUrl: "https://www.xiaohongshu.com/explore/mock",
							status: "succeeded",
						}),
					}),
				},
			},
		},
	};
});

const renderPublisher = () => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return render(
		<QueryClientProvider client={client}>
			<XiaohongshuPublisher />
		</QueryClientProvider>
	);
};

describe("XiaohongshuPublisher", () => {
	it("submits a valid image-text task through the mock flow", async () => {
		const user = userEvent.setup();
		renderPublisher();

		const publishButton = screen.getByRole("button", {
			name: "发布到小红书",
		});
		expect(publishButton).toHaveProperty("disabled", true);

		await user.type(screen.getByLabelText("标题"), "探店笔记");
		await user.type(screen.getByLabelText("正文"), "今天的咖啡很好喝");
		await user.type(screen.getByLabelText("本机媒体路径"), "/tmp/cover.png");
		await user.click(publishButton);

		expect(await screen.findByText("发布成功")).toBeTruthy();
		expect(invalidateQueries).toHaveBeenCalled();
	});
});
