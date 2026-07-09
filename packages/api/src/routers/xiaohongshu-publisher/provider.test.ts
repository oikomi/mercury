import { describe, expect, it } from "vitest";

import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import type {
	XiaohongshuPublishFailedResult,
	XiaohongshuPublishSubmittedUnknownResult,
} from "./provider";

const publishInput = {
	content: "正文",
	media: [
		{
			mimeType: "image/png",
			name: "cover.png",
			path: "/tmp/cover.png",
			size: 100,
			type: "image" as const,
		},
	],
	taskId: "task-1",
	title: "标题",
	topics: ["咖啡"],
	visibility: "public" as const,
};

describe("mock Xiaohongshu provider", () => {
	it("returns a deterministic success result", async () => {
		const provider = createMockXiaohongshuPublishProvider();

		const result = await provider.publish(publishInput);

		expect(result.status).toBe("succeeded");
		if (result.status !== "succeeded") {
			throw new Error("Expected mock provider publish to succeed.");
		}
		expect(result.resultUrl).toContain("xiaohongshu.com");
	});

	it("can simulate a provider failure", async () => {
		const provider = createMockXiaohongshuPublishProvider({
			mode: "fail",
		});

		const result = await provider.publish(publishInput);

		expect(result.status).toBe("failed");
		if (result.status !== "failed") {
			throw new Error("Expected mock provider publish to fail.");
		}
		expect(result.errorCode).toBe("mock_provider_failed");
	});

	it("returns ready mock account details", async () => {
		const provider = createMockXiaohongshuPublishProvider();

		const session = await provider.checkSession();

		expect(session).toEqual({
			displayName: "Mock Xiaohongshu",
			profilePath: "/tmp/mercury-xhs-profile",
			status: "ready",
		});
	});

	it("can simulate a submitted unknown provider result", async () => {
		const provider = createMockXiaohongshuPublishProvider({
			mode: "submitted_unknown",
		});

		const result = await provider.publish(publishInput);

		expect(result.status).toBe("submitted_unknown");
		if (result.status !== "submitted_unknown") {
			throw new Error(
				"Expected mock provider publish to be submitted unknown."
			);
		}
		expect(result.errorCode).toBe("submitted_unknown");
	});

	it("allows unresolved provider results to carry debug screenshots", () => {
		const failedResult = {
			debugScreenshotPath: "/tmp/xhs-failed.png",
			errorCode: "mock_provider_failed",
			errorMessage: "Mock Xiaohongshu provider failed by request.",
			status: "failed",
		} satisfies XiaohongshuPublishFailedResult;
		const submittedUnknownResult = {
			debugScreenshotPath: "/tmp/xhs-submitted-unknown.png",
			errorCode: "submitted_unknown",
			errorMessage:
				"Mock Xiaohongshu provider submitted the note but could not verify the result.",
			status: "submitted_unknown",
		} satisfies XiaohongshuPublishSubmittedUnknownResult;

		expect(failedResult.debugScreenshotPath).toBe("/tmp/xhs-failed.png");
		expect(submittedUnknownResult.debugScreenshotPath).toBe(
			"/tmp/xhs-submitted-unknown.png"
		);
	});
});
