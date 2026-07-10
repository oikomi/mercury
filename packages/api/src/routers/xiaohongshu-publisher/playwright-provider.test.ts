import { describe, expect, it } from "vitest";

import { resolvePublishConfirmation } from "./playwright-provider";

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
