import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
		},
	},
	test: {
		env: {
			BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
			BETTER_AUTH_URL: "http://localhost:3001",
			CORS_ORIGIN: "http://localhost:3001",
			DATABASE_URL:
				"postgresql://postgres:password@localhost:5432/mercury_test",
			NODE_ENV: "test",
		},
		environment: "node",
		globals: true,
		include: [
			"packages/**/*.test.ts",
			"packages/**/*.test.tsx",
			"apps/**/*.test.ts",
			"apps/**/*.test.tsx",
		],
	},
});
