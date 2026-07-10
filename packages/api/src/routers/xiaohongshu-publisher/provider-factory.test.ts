import { describe, expect, it } from "vitest";

import { createXiaohongshuPublishProvider } from "./provider-factory";

describe("createXiaohongshuPublishProvider", () => {
	it("creates the mock provider explicitly", async () => {
		const provider = createXiaohongshuPublishProvider({
			artifactDir: ".data/test-artifacts",
			profileDir: ".data/test-profile",
			provider: "mock",
		});

		const session = await provider.checkSession();

		expect(session.status).toBe("ready");
	});

	it("creates an interactive Playwright provider without opening a browser", () => {
		const provider = createXiaohongshuPublishProvider({
			artifactDir: ".data/test-artifacts",
			profileDir: ".data/test-profile",
			provider: "playwright",
		});

		expect(provider.checkSession).toBeTypeOf("function");
		expect(provider.publish).toBeTypeOf("function");
		expect(provider.startLogin).toBeTypeOf("function");
	});
});
