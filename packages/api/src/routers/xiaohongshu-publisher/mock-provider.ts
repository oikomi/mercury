import type {
	XiaohongshuPublishInput,
	XiaohongshuPublishProvider,
	XiaohongshuPublishResult,
	XiaohongshuSessionStatus,
} from "./provider";

export type MockXiaohongshuPublishProviderMode =
	| "success"
	| "fail"
	| "submitted_unknown";

export interface MockXiaohongshuPublishProviderOptions {
	mode?: MockXiaohongshuPublishProviderMode;
}

export function createMockXiaohongshuPublishProvider(
	options: MockXiaohongshuPublishProviderOptions = {}
): XiaohongshuPublishProvider {
	const mode = options.mode ?? "success";

	return {
		checkSession: (): Promise<XiaohongshuSessionStatus> =>
			Promise.resolve({
				displayName: "Mock Xiaohongshu",
				profilePath: "/tmp/mercury-xhs-profile",
				status: "ready",
			}),
		publish: (
			input: XiaohongshuPublishInput
		): Promise<XiaohongshuPublishResult> => {
			if (mode === "fail") {
				return Promise.resolve({
					errorCode: "mock_provider_failed",
					errorMessage: "Mock Xiaohongshu provider failed by request.",
					status: "failed",
				});
			}

			if (mode === "submitted_unknown") {
				return Promise.resolve({
					errorCode: "submitted_unknown",
					errorMessage:
						"Mock Xiaohongshu provider submitted the note but could not verify the result.",
					status: "submitted_unknown",
				});
			}

			return Promise.resolve({
				publishedAt: new Date(),
				resultUrl: `https://www.xiaohongshu.com/explore/mock-${input.taskId}`,
				status: "succeeded",
			});
		},
		startLogin: (): Promise<XiaohongshuSessionStatus> =>
			Promise.resolve({
				displayName: "Mock Xiaohongshu",
				profilePath: "/tmp/mercury-xhs-profile",
				status: "ready",
			}),
	};
}
