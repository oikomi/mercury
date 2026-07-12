import type { Page, Request } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
	clickPublish,
	fillDescription,
	getCreatorPublishUrl,
	resolvePublishConfirmation,
	uploadMedia,
} from "./playwright-provider";

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
