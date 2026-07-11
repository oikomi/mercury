import { env } from "@mercury/env/server";
import { z } from "zod";

import { protectedProcedure, router } from "../../index";
import {
	createXiaohongshuAiDraftGenerator,
	type XiaohongshuAiDraftGenerator,
} from "./ai-draft";
import { createDbXiaohongshuPublisherRepository } from "./db-repository";
import { createXiaohongshuPublishProvider } from "./provider-factory";
import {
	createPublishTaskInputSchema,
	generateDraftInputSchema,
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
		provider: createXiaohongshuPublishProvider(),
		repository: createDbXiaohongshuPublisherRepository(),
	}),
	aiDraftGenerator: XiaohongshuAiDraftGenerator = createXiaohongshuAiDraftGenerator(
		{
			apiKey: env.XHS_AI_API_KEY ?? "",
			mediaDir: ".data/xhs-media",
		}
	)
) =>
	router({
		createTask: protectedProcedure
			.input(createPublishTaskInputSchema)
			.mutation(({ ctx, input }) =>
				service.createTask(ctx.session.user.id, input)
			),
		generateDraft: protectedProcedure
			.input(generateDraftInputSchema)
			.mutation(({ input }) => aiDraftGenerator.generate(input)),
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
		refreshAccountStatus: protectedProcedure.mutation(({ ctx }) =>
			service.refreshAccountStatus(ctx.session.user.id)
		),
		startLogin: protectedProcedure.mutation(({ ctx }) =>
			service.startLogin(ctx.session.user.id)
		),
	});

export const xiaohongshuPublisherRouter = createXiaohongshuPublisherRouter();
