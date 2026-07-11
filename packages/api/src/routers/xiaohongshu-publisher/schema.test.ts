import { describe, expect, it } from "vitest";

import {
	createPublishTaskInputSchema,
	generateDraftInputSchema,
	getTaskInputSchema,
	normalizeTopics,
	publishTaskInputSchema,
	xiaohongshuVisibilityValues,
} from "./schema";

describe("generateDraftInputSchema", () => {
	it("accepts a supported image data URL and optional intent", () => {
		expect(generateDraftInputSchema).toBeDefined();
		if (!generateDraftInputSchema) {
			return;
		}

		const result = generateDraftInputSchema.parse({
			imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
			intent: "轻松吐槽服务器故障",
		});

		expect(result.intent).toBe("轻松吐槽服务器故障");
	});

	it.each([
		"data:text/plain;base64,SGVsbG8=",
		"https://example.com/a.png",
	])("rejects unsupported image input %s", (imageDataUrl) => {
		expect(generateDraftInputSchema).toBeDefined();
		if (!generateDraftInputSchema) {
			return;
		}

		expect(generateDraftInputSchema.safeParse({ imageDataUrl }).success).toBe(
			false
		);
	});

	it("rejects intent longer than 500 characters", () => {
		expect(generateDraftInputSchema).toBeDefined();
		if (!generateDraftInputSchema) {
			return;
		}

		expect(
			generateDraftInputSchema.safeParse({
				imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
				intent: "a".repeat(501),
			}).success
		).toBe(false);
	});
});

describe("createPublishTaskInputSchema", () => {
	it("accepts a valid image-text note payload", () => {
		const result = createPublishTaskInputSchema.parse({
			content: "正文内容 #探店",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: "/tmp/cover.png",
					size: 1024,
					type: "image",
				},
			],
			title: "探店笔记",
			topics: [" #探店 ", "", "咖啡", "#探店"],
			visibility: "public",
		});

		expect(result.topics).toEqual(["探店", "咖啡"]);
		expect(result.visibility).toBe("public");
	});

	it("requires at least one media item", () => {
		const result = createPublishTaskInputSchema.safeParse({
			content: "正文内容",
			media: [],
			title: "标题",
			topics: [],
			visibility: "public",
		});

		expect(result.success).toBe(false);
	});

	it.each([
		["mimeType", { mimeType: "   " }],
		["name", { name: "   " }],
		["path", { path: "   " }],
	] as const)("rejects whitespace-only media %s", (_field, mediaOverrides) => {
		const result = createPublishTaskInputSchema.safeParse({
			content: "正文内容",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: "/tmp/cover.png",
					size: 1024,
					type: "image",
					...mediaOverrides,
				},
			],
			title: "标题",
			topics: [],
			visibility: "public",
		});

		expect(result.success).toBe(false);
	});

	it("preserves media path values while validating them", () => {
		const result = createPublishTaskInputSchema.parse({
			content: "正文内容",
			media: [
				{
					mimeType: "image/png",
					name: "cover.png",
					path: " /tmp/cover image.png ",
					size: 1024,
					type: "image",
				},
			],
			title: "标题",
			topics: [],
			visibility: "public",
		});

		expect(result.media[0]?.path).toBe(" /tmp/cover image.png ");
	});

	it("normalizes topics by trimming hashtags and empty values", () => {
		expect(normalizeTopics([" #咖啡 ", "", "探店", "#咖啡"])).toEqual([
			"咖啡",
			"探店",
		]);
	});

	it("keeps the supported visibility values explicit", () => {
		expect(xiaohongshuVisibilityValues).toEqual([
			"public",
			"private",
			"followers",
		]);
	});
});

describe("task input schemas", () => {
	it("rejects whitespace-only task ids", () => {
		expect(publishTaskInputSchema.safeParse({ taskId: "   " }).success).toBe(
			false
		);
		expect(getTaskInputSchema.safeParse({ taskId: "   " }).success).toBe(false);
	});
});
