import { createContext } from "@mercury/api/context";
import { appRouter } from "@mercury/api/routers/index";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { withEvlog } from "@/lib/evlog";

function handler(req: NextRequest) {
	return fetchRequestHandler({
		createContext,
		endpoint: "/api/trpc",
		req,
		router: appRouter,
	});
}
export const GET = withEvlog(handler);
export const POST = withEvlog(handler);
