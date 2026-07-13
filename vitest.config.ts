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
