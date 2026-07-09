import type {
	XiaohongshuAccountStatus,
	XiaohongshuMedia,
	XiaohongshuVisibility,
} from "./schema";

export interface XiaohongshuSessionStatus {
	displayName: string | null;
	profilePath: string | null;
	status: XiaohongshuAccountStatus;
}

export interface XiaohongshuPublishInput {
	content: string;
	media: readonly XiaohongshuMedia[];
	taskId: string;
	title: string;
	topics: readonly string[];
	visibility: XiaohongshuVisibility;
}

export interface XiaohongshuPublishSucceededResult {
	publishedAt: Date;
	resultUrl: string;
	status: "succeeded";
}

export interface XiaohongshuPublishFailedResult {
	debugScreenshotPath?: string;
	errorCode: string;
	errorMessage: string;
	status: "failed";
}

export interface XiaohongshuPublishSubmittedUnknownResult {
	debugScreenshotPath?: string;
	errorCode: "submitted_unknown";
	errorMessage: string;
	status: "submitted_unknown";
}

export type XiaohongshuPublishResult =
	| XiaohongshuPublishSucceededResult
	| XiaohongshuPublishFailedResult
	| XiaohongshuPublishSubmittedUnknownResult;

export interface XiaohongshuPublishProvider {
	checkSession: () => Promise<XiaohongshuSessionStatus>;
	publish: (
		input: XiaohongshuPublishInput
	) => Promise<XiaohongshuPublishResult>;
}
