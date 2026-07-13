import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	emptyStringAsUndefined: true,
	runtimeEnv: process.env,
	server: {
		DATABASE_URL: z.string().min(1),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		XHS_AI_API_KEY: z.string().trim().min(1).optional(),
		XHS_ARTIFACT_DIR: z.string().default(".data/xhs-artifacts"),
		XHS_PROFILE_DIR: z.string().default(".data/xhs-profile"),
		XHS_PROVIDER: z.enum(["mock", "playwright"]).default("playwright"),
	},
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
