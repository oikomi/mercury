import { publicProcedure, router } from "../index";
import { xiaohongshuPublisherRouter } from "./xiaohongshu-publisher/router";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => "OK"),
	xiaohongshuPublisher: xiaohongshuPublisherRouter,
});
export type AppRouter = typeof appRouter;
