import type { Page } from "playwright";
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
	it("clicks the final publish control by its exact text", async () => {
		const click = vi.fn().mockResolvedValue(undefined);
		const last = vi.fn(() => ({ click }));
		const page = {
			getByText: vi.fn(() => ({ last })),
		} as unknown as Page;

		await clickPublish(page);

		expect(page.getByText).toHaveBeenCalledWith("发布", { exact: true });
		expect(last).toHaveBeenCalledOnce();
		expect(click).toHaveBeenCalledWith({ timeout: 30_000 });
	});
});
