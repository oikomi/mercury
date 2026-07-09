import { auth } from "@mercury/auth";
import {
	type BetterAuthInstance,
	createAuthMiddleware,
} from "evlog/better-auth";

import { getLogger } from "@/lib/evlog";

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
	exclude: ["/api/auth/**"],
	maskEmail: true,
});

export async function identifyEvlogUser(request: Request) {
	await identifyUser(
		getLogger(),
		request.headers,
		new URL(request.url).pathname
	);
}
