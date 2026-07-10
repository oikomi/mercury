import { z } from "zod";

import { protectedProcedure, router } from "../../index";
import { createDbXiaohongshuPublisherRepository } from "./db-repository";
import { createMockXiaohongshuPublishProvider } from "./mock-provider";
import {
	createPublishTaskInputSchema,
	getTaskInputSchema,
	publishTaskInputSchema,
} from "./schema";
import {
	createXiaohongshuPublisherService,
	type XiaohongshuPublisherService,
} from "./service";

const listTasksInputSchema = z.object({
	limit: z.number().int().min(1).max(50).default(20),
});

export const createXiaohongshuPublisherRouter = (
	service: XiaohongshuPublisherService = createXiaohongshuPublisherService({
		provider: createMockXiaohongshuPublishProvider(),
		repository: createDbXiaohongshuPublisherRepository(),
	})
) =>
	router({
		createTask: protectedProcedure
			.input(createPublishTaskInputSchema)
			.mutation(({ ctx, input }) =>
				service.createTask(ctx.session.user.id, input)
			),
		getAccountStatus: protectedProcedure.query(({ ctx }) =>
			service.getAccountStatus(ctx.session.user.id)
		),
		getTask: protectedProcedure
			.input(getTaskInputSchema)
			.query(({ ctx, input }) =>
				service.getTask(ctx.session.user.id, input.taskId)
			),
		listTasks: protectedProcedure
			.input(listTasksInputSchema)
			.query(({ ctx, input }) =>
				service.listTasks(ctx.session.user.id, input.limit)
			),
		publishTask: protectedProcedure
			.input(publishTaskInputSchema)
			.mutation(({ ctx, input }) =>
				service.publishTask(ctx.session.user.id, input.taskId)
			),
	});

export const xiaohongshuPublisherRouter = createXiaohongshuPublisherRouter();
