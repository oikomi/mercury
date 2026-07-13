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
		initialStyleIndex?: number;
		mediaDir: string;
		now?: () => Date;
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
			content: "服务器上午突然没响应了。",
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
			now: () => new Date("2026-07-13T04:00:00.000Z"),
			randomId: () => "draft-image",
		});

		const result = await generator.generate({
			imageDataUrl: PNG_DATA_URL,
			intent: "轻松吐槽",
			style: "dry_humor",
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
			reasoning: { effort: string };
		};
		expect(requestBody.model).toBe("gpt-5.6-sol");
		expect(requestBody.reasoning).toEqual({ effort: "max" });
		expect(requestBody.input[0]?.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "input_text" }),
				{ image_url: PNG_DATA_URL, type: "input_image" },
			])
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain("轻松吐槽");
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"绝不超过 20 个字符"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"本篇用「轻吐槽」写法"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"使用用户手动选择的风格，不叠加日期主风格"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"标题必须有具体钩子"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"第二段只能是一句短短的轻吐槽或无奈反应"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"不要把未知写成坏结果"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"用户没明确要建议时，不安排下一步"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"宁可不用，也不要固定用“谁懂啊、家人们、真的会谢”开头"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"本篇不刻意制造错误"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"正文第一句直接进事情"
		);
		expect(requestBody.input[0]?.content[0]?.text).toContain(
			"不要为了更完整再补一段总结"
		);
	});

	it("rotates automatic styles and avoids the last manually selected style", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const fetchFn = vi.fn((_requestUrl: string, _requestInit?: RequestInit) =>
			Promise.resolve(
				createSuccessResponse(
					JSON.stringify({ content: "正文", title: "标题", topics: [] })
				)
			)
		);
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			initialStyleIndex: 0,
			mediaDir: temporaryDirectory,
			now: () => new Date("2026-07-13T04:00:00.000Z"),
		});

		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });
		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });
		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "story" });
		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });

		const prompts = fetchFn.mock.calls.map(([, requestInit]) => {
			const requestBody = JSON.parse(String(requestInit?.body)) as {
				input: Array<{ content: Array<{ text?: string }> }>;
			};
			return requestBody.input[0]?.content[0]?.text ?? "";
		});
		expect(prompts).toHaveLength(4);
		expect(prompts[0]).toContain("本篇用「朋友聊天」写法");
		expect(prompts[1]).toContain("本篇用「随手碎碎念」写法");
		expect(prompts[2]).toContain("本篇用「现场叙事」写法");
		expect(prompts[3]).toContain("本篇用「克制观察」写法");
		expect(prompts[1]).toContain("最近生成的稿件指纹");
		expect(prompts[1]).toContain('"title":"标题"');
		expect(prompts[0]).toContain("本篇不刻意制造错误");
		expect(prompts[1]).toContain("本篇不刻意制造错误");
		expect(prompts[2]).toContain("必须恰好保留一处轻微的真人瑕疵");
		expect(prompts[3]).toContain("本篇不刻意制造错误");
	});

	it("uses a different calendar style each day and loops after day 30", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		let currentDate = new Date("2026-07-01T04:00:00.000Z");
		const fetchFn = vi.fn((_requestUrl: string, _requestInit?: RequestInit) =>
			Promise.resolve(
				createSuccessResponse(
					JSON.stringify({ content: "正文", title: "标题", topics: [] })
				)
			)
		);
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
			now: () => currentDate,
		});

		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });
		currentDate = new Date("2026-07-02T04:00:00.000Z");
		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });
		currentDate = new Date("2026-07-30T04:00:00.000Z");
		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });
		currentDate = new Date("2026-07-31T04:00:00.000Z");
		await generator.generate({ imageDataUrl: PNG_DATA_URL, style: "auto" });

		const prompts = fetchFn.mock.calls.map(([, requestInit]) => {
			const requestBody = JSON.parse(String(requestInit?.body)) as {
				input: Array<{ content: Array<{ text?: string }> }>;
			};
			return requestBody.input[0]?.content[0]?.text ?? "";
		});
		expect(prompts[0]).toContain("每日主风格是「原话开场」");
		expect(prompts[0]).toContain("本篇用「朋友聊天」写法");
		expect(prompts[1]).toContain("每日主风格是「数字切面」");
		expect(prompts[1]).toContain("本篇用「随手碎碎念」写法");
		expect(prompts[2]).toContain("每日主风格是「留白收尾」");
		expect(prompts[2]).toContain("本篇用「温柔共情」写法");
		expect(prompts[2]).toContain("必须恰好保留一处轻微的真人瑕疵");
		expect(prompts[3]).toContain("每日主风格是「原话开场」");
		expect(prompts[3]).toContain("本篇用「朋友聊天」写法");
	});

	it("truncates an overlong generated title before returning the draft", async () => {
		const aiDraftModule = await loadAiDraftModule();
		if (!aiDraftModule) {
			return;
		}

		const fetchFn = vi.fn(async () =>
			createSuccessResponse(
				JSON.stringify({
					content: "正文",
					title: "标".repeat(21),
					topics: [],
				})
			)
		);
		const generator = aiDraftModule.createXiaohongshuAiDraftGenerator({
			apiKey: "test-key",
			fetchFn: fetchFn as unknown as typeof fetch,
			mediaDir: temporaryDirectory,
		});

		const draft = await generator.generate({ imageDataUrl: PNG_DATA_URL });

		expect(draft.title).toBe("标".repeat(20));
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
