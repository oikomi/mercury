import { z } from "zod";

import {
	XIAOHONGSHU_DRAFT_STYLE_VALUES,
	XIAOHONGSHU_TITLE_MAX_LENGTH,
} from "./constants";

const LEADING_HASHTAGS_PATTERN = /^#+/;
const IMAGE_DATA_URL_PATTERN =
	/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/u;

export const generateDraftInputSchema = z.object({
	imageDataUrl: z.string().max(14_000_000).regex(IMAGE_DATA_URL_PATTERN),
	intent: z.string().trim().max(500).optional(),
	style: z.enum(XIAOHONGSHU_DRAFT_STYLE_VALUES).default("auto"),
});

export const xiaohongshuVisibilityValues = [
	"public",
	"private",
	"followers",
] as const;

export const xiaohongshuTaskStatusValues = [
	"created",
	"validating",
	"opening_browser",
	"checking_login",
	"uploading_media",
	"filling_form",
	"submitting",
	"verifying_result",
	"succeeded",
	"failed",
	"submitted_unknown",
] as const;

export const xiaohongshuAccountStatusValues = [
	"not_configured",
	"login_required",
	"ready",
	"expired",
	"error",
] as const;

export const xiaohongshuMediaTypeValues = ["image", "video"] as const;

export const xiaohongshuMediaSchema = z.object({
	mimeType: z.string().trim().min(1),
	name: z.string().trim().min(1),
	path: z
		.string()
		.refine((value) => value.trim().length > 0, "Media path is required"),
	size: z.number().int().positive(),
	type: z.enum(xiaohongshuMediaTypeValues),
});

export const createPublishTaskInputSchema = z.object({
	content: z.string().trim().min(1).max(5000),
	media: z.array(xiaohongshuMediaSchema).min(1).max(18),
	title: z.string().trim().min(1).max(XIAOHONGSHU_TITLE_MAX_LENGTH),
	topics: z
		.array(z.string())
		.default([])
		.transform((topics) => normalizeTopics(topics)),
	visibility: z.enum(xiaohongshuVisibilityValues).default("public"),
});

export const publishTaskInputSchema = z.object({
	taskId: z.string().trim().min(1),
});

export const getTaskInputSchema = z.object({
	taskId: z.string().trim().min(1),
});

export type XiaohongshuVisibility =
	(typeof xiaohongshuVisibilityValues)[number];
export type XiaohongshuTaskStatus =
	(typeof xiaohongshuTaskStatusValues)[number];
export type XiaohongshuAccountStatus =
	(typeof xiaohongshuAccountStatusValues)[number];
export type XiaohongshuMediaType = (typeof xiaohongshuMediaTypeValues)[number];
export type XiaohongshuMedia = z.infer<typeof xiaohongshuMediaSchema>;
export type CreatePublishTaskInput = z.input<
	typeof createPublishTaskInputSchema
>;
export type GenerateDraftInput = z.input<typeof generateDraftInputSchema>;
export type NormalizedPublishTaskInput = z.output<
	typeof createPublishTaskInputSchema
>;

export function normalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];

	for (const topic of topics) {
		const value = topic.trim().replace(LEADING_HASHTAGS_PATTERN, "").trim();
		if (!value || seen.has(value)) {
			continue;
		}

		seen.add(value);
		normalized.push(value);
	}

	return normalized;
}
