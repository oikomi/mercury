// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import XiaohongshuPublisher from "./xiaohongshu-publisher";

const { accountStatus, invalidateQueries, refreshAccountStatus, startLogin } =
	vi.hoisted(() => ({
		accountStatus: {
			displayName: "我的小红书账号",
			status: "ready",
		},
		invalidateQueries: vi.fn(async () => undefined),
		refreshAccountStatus: vi.fn(async () => ({ status: "ready" })),
		startLogin: vi.fn(async () => ({ status: "ready" })),
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
						queryFn: async () => accountStatus,
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
				refreshAccountStatus: {
					mutationOptions: () => ({
						mutationFn: refreshAccountStatus,
					}),
				},
				startLogin: {
					mutationOptions: () => ({
						mutationFn: startLogin,
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
	beforeEach(() => {
		accountStatus.displayName = "我的小红书账号";
		accountStatus.status = "ready";
		invalidateQueries.mockClear();
		refreshAccountStatus.mockClear();
		startLogin.mockClear();
	});

	it("submits a valid image-text task through the mock flow", async () => {
		const user = userEvent.setup();
		renderPublisher();

		expect(await screen.findByText("公开")).toBeTruthy();
		expect((await screen.findAllByText("已就绪")).length).toBeGreaterThan(0);
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

	it("refreshes the account status on demand", async () => {
		const user = userEvent.setup();
		renderPublisher();

		await user.click(await screen.findByRole("button", { name: "重新检测" }));

		expect(refreshAccountStatus).toHaveBeenCalledOnce();
		expect(invalidateQueries).toHaveBeenCalled();
	});

	it("opens an interactive login window when login is required", async () => {
		accountStatus.displayName = "未登录账号";
		accountStatus.status = "login_required";
		const user = userEvent.setup();
		renderPublisher();

		await user.click(
			await screen.findByRole("button", { name: "打开登录窗口" })
		);

		expect(startLogin).toHaveBeenCalledOnce();
		expect(invalidateQueries).toHaveBeenCalled();
	});
});
