// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScreenshotDraftGenerator from "./screenshot-draft-generator";

const generatedDraft = {
	content: "生成正文",
	mediaPath: "/tmp/generated.png",
	title: "生成标题",
	topics: ["截图"],
};
const createObjectUrl = vi.fn(() => "blob:preview");
const revokeObjectUrl = vi.fn();
const PASTE_SCREENSHOT_NAME_PATTERN = /粘贴截图/u;
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,/u;

const pasteFile = (file: File): void => {
	fireEvent.paste(
		screen.getByRole("button", { name: PASTE_SCREENSHOT_NAME_PATTERN }),
		{
			clipboardData: {
				items: [
					{
						getAsFile: () => file,
						kind: "file",
						type: file.type,
					},
				],
			},
		}
	);
};

const createPngFile = (name = "screenshot.png"): File =>
	new File([new Uint8Array([137, 80, 78, 71])], name, {
		type: "image/png",
	});

describe("ScreenshotDraftGenerator", () => {
	beforeEach(() => {
		createObjectUrl.mockClear();
		revokeObjectUrl.mockClear();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectUrl,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectUrl,
		});
	});

	it("pastes a screenshot and generates a draft with optional intent", async () => {
		const onGenerate = vi.fn(async () => generatedDraft);
		const onGenerated = vi.fn();
		const onMediaInvalidated = vi.fn();
		const user = userEvent.setup();
		render(
			<ScreenshotDraftGenerator
				disabled={false}
				onGenerate={onGenerate}
				onGenerated={onGenerated}
				onMediaInvalidated={onMediaInvalidated}
			/>
		);

		pasteFile(createPngFile());

		expect(await screen.findByAltText("screenshot.png 预览")).toBeTruthy();
		expect(screen.getByText("screenshot.png")).toBeTruthy();
		await user.type(screen.getByLabelText("补充意图（可选）"), "轻松吐槽");
		await user.click(screen.getByRole("button", { name: "生成文案" }));

		await waitFor(() => {
			expect(onGenerate).toHaveBeenCalledWith({
				imageDataUrl: expect.stringMatching(PNG_DATA_URL_PATTERN),
				intent: "轻松吐槽",
			});
		});
		expect(onGenerated).toHaveBeenCalledWith(generatedDraft);
		expect(onMediaInvalidated).toHaveBeenCalledOnce();
		expect(await screen.findByText("文案已生成")).toBeTruthy();
	});

	it("rejects unsupported clipboard files", async () => {
		const onGenerate = vi.fn(async () => generatedDraft);
		render(
			<ScreenshotDraftGenerator
				disabled={false}
				onGenerate={onGenerate}
				onGenerated={vi.fn()}
				onMediaInvalidated={vi.fn()}
			/>
		);

		pasteFile(new File(["hello"], "notes.txt", { type: "text/plain" }));

		expect(await screen.findByText("不支持这种文件")).toBeTruthy();
		expect(onGenerate).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "生成文案" })).toHaveProperty(
			"disabled",
			true
		);
	});

	it("rejects screenshots larger than ten MiB", async () => {
		const onGenerate = vi.fn(async () => generatedDraft);
		render(
			<ScreenshotDraftGenerator
				disabled={false}
				onGenerate={onGenerate}
				onGenerated={vi.fn()}
				onMediaInvalidated={vi.fn()}
			/>
		);
		const oversizedFile = createPngFile("oversized.png");
		Object.defineProperty(oversizedFile, "size", {
			value: 10 * 1024 * 1024 + 1,
		});

		pasteFile(oversizedFile);

		expect(await screen.findByText("截图太大")).toBeTruthy();
		expect(onGenerate).not.toHaveBeenCalled();
	});

	it("keeps the selected screenshot when generation fails", async () => {
		const onGenerate = vi.fn(() =>
			Promise.reject(new Error("AI 服务暂时不可用"))
		);
		const onGenerated = vi.fn();
		const user = userEvent.setup();
		render(
			<ScreenshotDraftGenerator
				disabled={false}
				onGenerate={onGenerate}
				onGenerated={onGenerated}
				onMediaInvalidated={vi.fn()}
			/>
		);

		pasteFile(createPngFile());
		await user.click(screen.getByRole("button", { name: "生成文案" }));

		expect(await screen.findByText("生成失败")).toBeTruthy();
		expect(screen.getByText("AI 服务暂时不可用")).toBeTruthy();
		expect(screen.getByAltText("screenshot.png 预览")).toBeTruthy();
		expect(onGenerated).not.toHaveBeenCalled();
	});

	it("replaces and removes screenshots without retaining stale media", async () => {
		const onMediaInvalidated = vi.fn();
		const user = userEvent.setup();
		render(
			<ScreenshotDraftGenerator
				disabled={false}
				onGenerate={vi.fn(async () => generatedDraft)}
				onGenerated={vi.fn()}
				onMediaInvalidated={onMediaInvalidated}
			/>
		);

		pasteFile(createPngFile("first.png"));
		expect(await screen.findByText("first.png")).toBeTruthy();
		pasteFile(createPngFile("replacement.png"));

		expect(await screen.findByText("replacement.png")).toBeTruthy();
		await waitFor(() => {
			expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview");
		});
		await user.click(screen.getByRole("button", { name: "删除截图" }));

		expect(screen.queryByText("replacement.png")).toBeNull();
		expect(onMediaInvalidated).toHaveBeenCalledTimes(3);
	});
});
