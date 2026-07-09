import { describe, expect, it } from "vitest";

import {
	createPublishTaskInputSchema,
	getTaskInputSchema,
	normalizeTopics,
	publishTaskInputSchema,
	xiaohongshuVisibilityValues,
} from "./schema";

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
