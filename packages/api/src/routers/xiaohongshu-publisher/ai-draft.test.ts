import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerateDraftInput } from "./schema";

interface AiDraft {
	content: string;
	mediaPath: string;
	title: string;
	topics: string[];
}

interface AiDraftGenerator {
	generate: (input: GenerateDraftInput) => Promise<AiDraft>;
}

interface AiDraftModule {
	createXiaohongshuAiDraftGenerator: (options: {
		apiKey: string;
		fetchFn?: typeof fetch;
		mediaDir: string;
		randomId?: () => string;
	}) => AiDraftGenerator;
}

const AI_DRAFT_MODULE_PATH = "./ai-draft";
const PNG_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

const createSuccessResponse = (outputText: string): Response =>
	new Response(
		JSON.stringify({
			output: [
				{
					content: [{ text: outputText, type: "output_text" }],
					type: "message",
				},
			],
		}),
		{ status: 200 }
	);

const loadAiDraftModule = async (): Promise<AiDraftModule | null> => {
	const loadedModule = await import(AI_DRAFT_MODULE_PATH).catch(() => null);
	expect(loadedModule).not.toBeNull();
	return loadedModule as AiDraftModule | null;
};

describe("createXiaohongshuAiDraftGenerator", () => {
	let temporaryDirectory = "";

	beforeEach(async () => {
		temporaryDirectory = await mkdtemp(
			path.join(tmpdir(), "mercury-xhs-ai-draft-")
		);
	});

	afterEach(async () => {
		await rm(temporaryDirectory, { force: true, recursive: true });
	});

	it("generates a validated draft and persists the screenshot", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const output = {
			content: "谁懂啊，服务器先下班了。",
			title: "服务器也想摸鱼",
			topics: ["程序员", "服务器"],
		};
		const fetchFn = vi.fn((_requestUrl: string, _requestInit?: RequestInit) =>
			Promise.resolve(createSuccessResponse(JSON.stringify(output)))
		);
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
			randomId: () => "draft-image",
		});

		const result = await generator.generate({
			imageDataUrl: PNG_DATA_URL,
			intent: "轻松吐槽",
		});

		expect(result).toEqual({
			...output,
			mediaPath: path.join(temporaryDirectory, "draft-image.png"),
		});
		expect(await readFile(result.mediaPath)).toEqual(
			Buffer.from(PNG_DATA_URL.split(",")[1] ?? "", "base64")
		);
		expect(fetchFn).toHaveBeenCalledOnce();
		const [requestUrl, requestInit] = fetchFn.mock.calls[0] ?? [];
		expect(requestUrl).toBe("https://aicoding.xdreamdev.com/v1/responses");
		expect(requestInit).toEqual(
			expect.objectContaining({
				headers: {
					Authorization: "Bearer test-key",
					"Content-Type": "application/json",
				},
				method: "POST",
			})
		);
		const requestBody = JSON.parse(String(requestInit?.body)) as {
			input: Array<{
				content: Array<{ image_url?: string; text?: string; type: string }>;
			}>;
			model: string;
		};
		expect(requestBody.model).toBe("gpt-5.6-sol");
		expect(requestBody.input[0]?.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "input_text" }),
				{ image_url: PNG_DATA_URL, type: "input_image" },
			])
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain("轻松吐槽");
	});

	it("rejects a MIME and image-signature mismatch", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const fetchFn = vi.fn();
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
		});

		await expect(
			generator.generate({
				imageDataUrl: "data:image/png;base64,/9j/4AAQ",
			})
		).rejects.toThrow("Invalid PNG image data.");
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("rejects decoded images larger than 10 MiB", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const oversizedPng = Buffer.concat([
			Buffer.from("89504e470d0a1a0a", "hex"),
			Buffer.alloc(10 * 1024 * 1024),
		]);
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			mediaDir: temporaryDirectory,
		});

		await expect(
			generator.generate({
				imageDataUrl: `data:image/png;base64,${oversizedPng.toString("base64")}`,
			})
		).rejects.toThrow("Image exceeds the 10 MiB limit.");
	});

	it("redacts an upstream authentication response", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const fetchFn = vi.fn(
			async () => new Response("secret upstream body", { status: 401 })
		);
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
		});

		await expect(
			generator.generate({ imageDataUrl: PNG_DATA_URL })
		).rejects.toThrow("AI service request failed (401).");
	});

	it("rejects malformed model JSON without writing media", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const fetchFn = vi.fn(async () => createSuccessResponse("not-json"));
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
		});

		await expect(
			generator.generate({ imageDataUrl: PNG_DATA_URL })
		).rejects.toThrow("AI service returned invalid draft JSON.");
		expect(await readdir(temporaryDirectory)).toEqual([]);
	});

	it("reports missing server configuration before making a request", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const fetchFn = vi.fn();
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
		});

		await expect(
			generator.generate({ imageDataUrl: PNG_DATA_URL })
		).rejects.toThrow("XHS_AI_API_KEY is not configured.");
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
