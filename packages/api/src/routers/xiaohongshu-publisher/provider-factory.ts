import { env } from "@mercury/env/server";

import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import { createPlaywrightXiaohongshuPublishProvider } from "./playwright-provider";
import type { XiaohongshuPublishProvider } from "./provider";

interface ProviderFactoryOptions {
	artifactDir?: string;
	profileDir?: string;
	provider?: "mock" | "playwright";
}

export function createXiaohongshuPublishProvider(
	options: ProviderFactoryOptions = {}
): XiaohongshuPublishProvider {
	const provider = options.provider ?? env.XHS_PROVIDER;
	if (provider === "playwright") {
		return createPlaywrightXiaohongshuPublishProvider({
			artifactDir: options.artifactDir ?? env.XHS_ARTIFACT_DIR,
			profileDir: options.profileDir ?? env.XHS_PROFILE_DIR,
		});
	}

	return createMockXiaohongshuPublishProvider();
}
