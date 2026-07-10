import { protectedProcedure, publicProcedure, router } from "../index";
import { xiaohongshuPublisherRouter } from "./xiaohongshu-publisher/router";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => "OK"),
	privateData: protectedProcedure.query(({ ctx }) => ({
		message: "This is private",
		user: ctx.session.user,
	})),
	xiaohongshuPublisher: xiaohongshuPublisherRouter,
});
export type AppRouter = typeof appRouter;
