import type { Page, Request } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
	clickPublish,
	fillDescription,
	fillTitle,
	fillTopics,
	getCreatorPublishUrl,
	getSessionStatus,
	isCreatorLoginUrl,
	resolvePublishConfirmation,
	uploadMedia,
} from "./playwright-provider";

describe("getSessionStatus", () => {
	it("prefers a rendered account over a transient login URL", async () => {
		const isVisible = vi.fn().mockResolvedValue(true);
		const textContent = vi.fn().mockResolvedValue(" 肥熊 ");
		const page = {
			getByText: vi.fn(() => ({ first: () => ({ isVisible }) })),
			locator: vi.fn(() => ({ first: () => ({ isVisible, textContent }) })),
			url: () => "https://creator.xiaohongshu.com/login",
		} as unknown as Page;

		const status = await getSessionStatus(page, "/tmp/xhs-profile");

		expect(status).toEqual({
			displayName: "肥熊",
			profilePath: "/tmp/xhs-profile",
			status: "ready",
		});
		expect(page.locator).toHaveBeenCalledWith(".user-info .name-box");
	});

	it("waits for a cached session to redirect away from the login form", async () => {
		const waitForTimeout = vi.fn().mockResolvedValue(undefined);
		const page = {
			getByText: vi
				.fn()
				.mockReturnValueOnce({
					first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
				})
				.mockReturnValueOnce({
					first: () => ({ isVisible: vi.fn().mockResolvedValue(true) }),
				}),
			locator: vi
				.fn()
				.mockReturnValueOnce({
					first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
				})
				.mockReturnValueOnce({
					first: () => ({
						isVisible: vi.fn().mockResolvedValue(true),
						textContent: vi.fn().mockResolvedValue("肥熊"),
					}),
				}),
			url: () => "https://creator.xiaohongshu.com/login",
			waitForTimeout,
		} as unknown as Page;

		const status = await getSessionStatus(page, "/tmp/xhs-profile");

		expect(status.status).toBe("ready");
		expect(status.displayName).toBe("肥熊");
		expect(waitForTimeout).toHaveBeenCalledWith(5000);
	});
});

describe("isCreatorLoginUrl", () => {
	it("recognizes only Xiaohongshu creator login routes", () => {
		expect(isCreatorLoginUrl("https://creator.xiaohongshu.com/login")).toBe(
			true
		);
		expect(
			isCreatorLoginUrl("https://creator.xiaohongshu.com/publish/publish")
		).toBe(false);
		expect(isCreatorLoginUrl("https://example.com/login")).toBe(false);
	});
});

describe("resolvePublishConfirmation", () => {
	it("does not treat the creator portal URL as a successful publish", () => {
		const result = resolvePublishConfirmation({
			currentUrl: "https://creator.xiaohongshu.com/publish/publish",
			linkedResultUrl: null,
			successVisible: true,
		});

		expect(result.status).toBe("submitted_unknown");
	});

	it("accepts a public note URL as explicit success evidence", () => {
		const result = resolvePublishConfirmation({
			currentUrl: "https://creator.xiaohongshu.com/publish/success",
			linkedResultUrl: "https://www.xiaohongshu.com/explore/abc123?source=web",
			successVisible: true,
		});

		expect(result).toEqual(
			expect.objectContaining({
				resultUrl: "https://www.xiaohongshu.com/explore/abc123",
				status: "succeeded",
			})
		);
	});

	it("accepts direct navigation to a public note URL", () => {
		const result = resolvePublishConfirmation({
			currentUrl: "https://www.xiaohongshu.com/explore/note987",
			linkedResultUrl: null,
			successVisible: false,
		});

		expect(result.status).toBe("succeeded");
	});
});

describe("getCreatorPublishUrl", () => {
	it("opens the image publishing form without triggering a native file picker", () => {
		const url = getCreatorPublishUrl("image");

		expect(url).toBe(
			"https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image"
		);
		expect(url).not.toContain("openFilePicker");
	});
});

describe("uploadMedia", () => {
	it("sets files on a hidden input without waiting for it to become visible", async () => {
		const setInputFiles = vi.fn().mockResolvedValue(undefined);
		const waitFor = vi.fn().mockRejectedValue(new Error("input is hidden"));
		const page = {
			locator: vi.fn(() => ({
				first: () => ({ setInputFiles, waitFor }),
			})),
		} as unknown as Page;

		await uploadMedia(page, [
			{
				mimeType: "image/png",
				name: "note.png",
				path: "/tmp/note.png",
				size: 1,
				type: "image",
			},
		]);

		expect(setInputFiles).toHaveBeenCalledWith(["/tmp/note.png"]);
		expect(waitFor).not.toHaveBeenCalled();
	});
});

describe("fillDescription", () => {
	it("fills the rich-text editor through its contenteditable element", async () => {
		const fill = vi.fn().mockResolvedValue(undefined);
		const page = {
			locator: vi.fn(() => ({
				first: () => ({ fill }),
			})),
		} as unknown as Page;

		await fillDescription(page, "自动填写正文");

		expect(page.locator).toHaveBeenCalledWith('[contenteditable="true"]');
		expect(fill).toHaveBeenCalledWith("自动填写正文", {
			timeout: 30_000,
		});
	});
});

describe("fillTopics", () => {
	it("selects exact topic suggestions so the editor creates linked topic entities", async () => {
		const press = vi.fn().mockResolvedValue(undefined);
		const pressSequentially = vi.fn().mockResolvedValue(undefined);
		const linkedTopicWaitFor = vi.fn().mockResolvedValue(undefined);
		const linkedTopics = {
			count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
			nth: vi.fn(() => ({ waitFor: linkedTopicWaitFor })),
		};
		const editor = {
			locator: vi.fn(() => linkedTopics),
			press,
			pressSequentially,
		};
		const topicButtonClick = vi.fn().mockResolvedValue(undefined);
		const suggestionClick = vi.fn().mockResolvedValue(undefined);
		const suggestionWaitFor = vi.fn().mockResolvedValue(undefined);
		const first = vi.fn(() => ({
			click: suggestionClick,
			waitFor: suggestionWaitFor,
		}));
		const getByText = vi.fn(() => ({ first }));
		const locator = vi.fn((selector: string) => {
			if (selector === '[contenteditable="true"]') {
				return { first: () => editor };
			}

			if (selector === "#topicBtn") {
				return { click: topicButtonClick };
			}

			return { getByText };
		});
		const page = { locator } as unknown as Page;

		await fillTopics(page, ["职场", "产品经理"]);

		expect(press).toHaveBeenNthCalledWith(1, "Enter");
		expect(press).toHaveBeenNthCalledWith(2, "Enter");
		expect(topicButtonClick).toHaveBeenCalledTimes(2);
		expect(pressSequentially).toHaveBeenNthCalledWith(1, "职场", {
			delay: 80,
		});
		expect(pressSequentially).toHaveBeenNthCalledWith(2, "产品经理", {
			delay: 80,
		});
		expect(getByText).toHaveBeenNthCalledWith(1, "#职场", { exact: true });
		expect(getByText).toHaveBeenNthCalledWith(2, "#产品经理", {
			exact: true,
		});
		expect(suggestionClick).toHaveBeenCalledTimes(2);
		expect(linkedTopicWaitFor).toHaveBeenCalledTimes(2);
	});

	it("rejects a missing exact topic instead of publishing plain hashtag text", async () => {
		const editor = {
			locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(0) })),
			press: vi.fn().mockResolvedValue(undefined),
			pressSequentially: vi.fn().mockResolvedValue(undefined),
		};
		const missingSuggestion = {
			first: () => ({
				waitFor: vi.fn().mockRejectedValue(new Error("not found")),
			}),
		};
		const page = {
			locator: vi.fn((selector: string) => {
				if (selector === '[contenteditable="true"]') {
					return { first: () => editor };
				}

				if (selector === "#topicBtn") {
					return { click: vi.fn().mockResolvedValue(undefined) };
				}

				return { getByText: () => missingSuggestion };
			}),
		} as unknown as Page;

		await expect(fillTopics(page, ["不存在的话题"])).rejects.toThrow(
			"小红书没有找到完全匹配的话题“不存在的话题”"
		);
	});
});

describe("fillTitle", () => {
	it("fills valid titles and rejects overlong titles before opening the form", async () => {
		const fill = vi.fn().mockResolvedValue(undefined);
		const page = {
			getByPlaceholder: vi.fn(() => ({
				first: () => ({ fill }),
			})),
		} as unknown as Page;

		await fillTitle(page, " 合规标题 ");

		expect(fill).toHaveBeenCalledWith("合规标题", { timeout: 30_000 });
		await expect(fillTitle(page, "标".repeat(21))).rejects.toThrow(
			"小红书标题最多 20 个字符"
		);
		expect(fill).toHaveBeenCalledOnce();
	});
});

describe("clickPublish", () => {
	it("clicks the real publish button inside the closed shadow root", async () => {
		const send = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({
				root: {
					attributes: [],
					children: [
						{
							attributes: ["submit-text", "发布"],
							nodeId: 2,
							nodeName: "XHS-PUBLISH-BTN",
							nodeType: 1,
							nodeValue: "",
							shadowRoots: [
								{
									attributes: [],
									children: [
										{
											attributes: ["class", "ce-btn white"],
											children: [
												{
													attributes: [],
													nodeId: 5,
													nodeName: "#text",
													nodeType: 3,
													nodeValue: "暂存离开",
												},
											],
											nodeId: 4,
											nodeName: "BUTTON",
											nodeType: 1,
											nodeValue: "",
										},
										{
											attributes: ["class", "ce-btn bg-red"],
											children: [
												{
													attributes: [],
													nodeId: 7,
													nodeName: "#text",
													nodeType: 3,
													nodeValue: "发布",
												},
											],
											nodeId: 6,
											nodeName: "BUTTON",
											nodeType: 1,
											nodeValue: "",
										},
									],
									nodeId: 3,
									nodeName: "#document-fragment",
									nodeType: 11,
									nodeValue: "",
								},
							],
						},
					],
					nodeId: 1,
					nodeName: "#document",
					nodeType: 9,
					nodeValue: "",
				},
			})
			.mockResolvedValueOnce({
				model: {
					border: [690, 835, 810, 835, 810, 875, 690, 875],
				},
			});
		const detach = vi.fn().mockResolvedValue(undefined);
		const newCDPSession = vi.fn().mockResolvedValue({ detach, send });
		const click = vi.fn().mockResolvedValue(undefined);
		const page = {
			context: () => ({ newCDPSession }),
			mouse: { click },
		} as unknown as Page;

		await clickPublish(page);

		expect(newCDPSession).toHaveBeenCalledWith(page);
		expect(send).toHaveBeenNthCalledWith(1, "DOM.enable");
		expect(send).toHaveBeenNthCalledWith(2, "DOM.getDocument", {
			depth: -1,
			pierce: true,
		});
		expect(send).toHaveBeenNthCalledWith(3, "DOM.getBoxModel", {
			nodeId: 6,
		});
		expect(click).toHaveBeenCalledWith(750, 855);
		expect(detach).toHaveBeenCalledOnce();
	});
});

describe("runAndWaitForCreatorApiIdle", () => {
	it("waits for Creator API activity to remain quiet before continuing", async () => {
		vi.useFakeTimers();
		try {
			type RequestHandler = (request: Request) => void;
			type IdleWaiter = (
				page: Page,
				operation: () => Promise<void>
			) => Promise<void>;

			const providerModule = await import("./playwright-provider");
			const idleWaiter = (
				providerModule as typeof providerModule & {
					runAndWaitForCreatorApiIdle?: IdleWaiter;
				}
			).runAndWaitForCreatorApiIdle;
			expect(idleWaiter).toBeTypeOf("function");
			if (!idleWaiter) {
				return;
			}

			const listeners = new Map<string, Set<RequestHandler>>();
			const on = vi.fn((event: string, handler: RequestHandler) => {
				const eventListeners =
					listeners.get(event) ?? new Set<RequestHandler>();
				eventListeners.add(handler);
				listeners.set(event, eventListeners);
			});
			const off = vi.fn((event: string, handler: RequestHandler) => {
				listeners.get(event)?.delete(handler);
			});
			const page = { off, on } as unknown as Page;
			const request = {
				resourceType: () => "xhr",
				url: () =>
					"https://creator.xiaohongshu.com/api/galaxy/v2/creator/recommend/suggest/topics",
			} as unknown as Request;
			const emit = (event: string, emittedRequest: Request): void => {
				for (const handler of listeners.get(event) ?? []) {
					handler(emittedRequest);
				}
			};
			const operation = vi.fn(() => {
				emit("request", request);
				setTimeout(() => emit("requestfinished", request), 500);
				return Promise.resolve();
			});

			let settled = false;
			const idlePromise = idleWaiter(page, operation).then(() => {
				settled = true;
			});
			await vi.advanceTimersByTimeAsync(1900);

			expect(settled).toBe(false);

			await vi.advanceTimersByTimeAsync(200);
			await idlePromise;

			expect(operation).toHaveBeenCalledOnce();
			expect(settled).toBe(true);
			expect(off).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});
});
