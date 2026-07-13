// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import XiaohongshuPublisher from "./xiaohongshu-publisher";

const {
	accountStatus,
	createTask,
	generateDraft,
	invalidateQueries,
	refreshAccountStatus,
	startLogin,
} = vi.hoisted(() => ({
	accountStatus: {
		displayName: "我的小红书账号",
		status: "ready",
	},
	createTask: vi.fn(),
	generateDraft: vi.fn(async () => ({
		content: "服务器先下班了，打工人继续营业。",
		mediaPath: "/tmp/pasted-screenshot.png",
		title: "服务器也想摸鱼",
		topics: ["程序员", "服务器"],
	})),
	invalidateQueries: vi.fn(async () => undefined),
	refreshAccountStatus: vi.fn(async () => ({ status: "ready" })),
	startLogin: vi.fn(async () => ({ status: "ready" })),
}));

const PASTE_SCREENSHOT_NAME_PATTERN = /粘贴截图/u;

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
						mutationFn: (input: unknown) => {
							createTask(input);
							return Promise.resolve(createdTask);
						},
					}),
				},
				generateDraft: {
					mutationOptions: () => ({
						mutationFn: generateDraft,
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
		createTask.mockClear();
		generateDraft.mockClear();
		invalidateQueries.mockClear();
		refreshAccountStatus.mockClear();
		startLogin.mockClear();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:publisher-preview"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
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
		await user.type(
			screen.getByLabelText("本机媒体路径（可选）"),
			"/tmp/cover.png"
		);
		await user.click(publishButton);

		expect(await screen.findByText("发布成功")).toBeTruthy();
		expect(createTask).toHaveBeenCalledWith(
			expect.objectContaining({
				media: [expect.objectContaining({ path: "/tmp/cover.png" })],
			})
		);
		expect(invalidateQueries).toHaveBeenCalled();
	});

	it("limits titles to the 20 characters accepted by Xiaohongshu", async () => {
		const user = userEvent.setup();
		renderPublisher();
		const titleInput = screen.getByLabelText("标题") as HTMLInputElement;

		expect(titleInput.maxLength).toBe(20);
		await user.type(titleInput, "标".repeat(21));

		expect(titleInput.value).toBe("标".repeat(20));
		expect(screen.getByText("20/20")).toBeTruthy();
	});

	it("fills the form from a screenshot and publishes the generated media", async () => {
		const user = userEvent.setup();
		renderPublisher();
		const screenshot = new File(
			[new Uint8Array([137, 80, 78, 71])],
			"server.png",
			{ type: "image/png" }
		);

		fireEvent.paste(
			screen.getByRole("button", { name: PASTE_SCREENSHOT_NAME_PATTERN }),
			{
				clipboardData: {
					items: [
						{
							getAsFile: () => screenshot,
							kind: "file",
							type: screenshot.type,
						},
					],
				},
			}
		);
		await user.type(screen.getByLabelText("补充意图（可选）"), "轻松吐槽");
		await user.click(screen.getByRole("button", { name: "生成文案" }));

		await waitFor(() => {
			expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe(
				"服务器也想摸鱼"
			);
		});
		expect((screen.getByLabelText("正文") as HTMLTextAreaElement).value).toBe(
			"服务器先下班了，打工人继续营业。"
		);
		expect((screen.getByLabelText("话题") as HTMLInputElement).value).toBe(
			"#程序员 #服务器"
		);
		expect(generateDraft).toHaveBeenCalledWith(
			expect.objectContaining({ intent: "轻松吐槽" }),
			expect.anything()
		);

		await user.type(
			screen.getByLabelText("本机媒体路径（可选）"),
			"/tmp/manual.png"
		);
		const publishButton = screen.getByRole("button", {
			name: "发布到小红书",
		});
		await waitFor(() => {
			expect(publishButton).toHaveProperty("disabled", false);
		});
		await user.click(publishButton);

		await waitFor(() => {
			expect(createTask).toHaveBeenCalledWith(
				expect.objectContaining({
					media: [
						expect.objectContaining({
							path: "/tmp/pasted-screenshot.png",
						}),
					],
				})
			);
		});
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
