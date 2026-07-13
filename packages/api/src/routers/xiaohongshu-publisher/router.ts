import { env } from "@mercury/env/server";
import { z } from "zod";

import { publicProcedure, router } from "../../index";
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
const LOCAL_PUBLISHER_USER_ID = "mercury-local-publisher";

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
		createTask: publicProcedure
			.input(createPublishTaskInputSchema)
			.mutation(({ input }) =>
				service.createTask(LOCAL_PUBLISHER_USER_ID, input)
			),
		generateDraft: publicProcedure
			.input(generateDraftInputSchema)
			.mutation(({ input }) => aiDraftGenerator.generate(input)),
		getAccountStatus: publicProcedure.query(() =>
			service.getAccountStatus(LOCAL_PUBLISHER_USER_ID)
		),
		getTask: publicProcedure
			.input(getTaskInputSchema)
			.query(({ input }) =>
				service.getTask(LOCAL_PUBLISHER_USER_ID, input.taskId)
			),
		listTasks: publicProcedure
			.input(listTasksInputSchema)
			.query(({ input }) =>
				service.listTasks(LOCAL_PUBLISHER_USER_ID, input.limit)
			),
		publishTask: publicProcedure
			.input(publishTaskInputSchema)
			.mutation(({ input }) =>
				service.publishTask(LOCAL_PUBLISHER_USER_ID, input.taskId)
			),
		refreshAccountStatus: publicProcedure.mutation(() =>
			service.refreshAccountStatus(LOCAL_PUBLISHER_USER_ID)
		),
		startLogin: publicProcedure.mutation(() =>
			service.startLogin(LOCAL_PUBLISHER_USER_ID)
		),
	});

export const xiaohongshuPublisherRouter = createXiaohongshuPublisherRouter();
