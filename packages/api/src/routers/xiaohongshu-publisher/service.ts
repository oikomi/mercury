import type {
	XiaohongshuPublishInput,
	XiaohongshuPublishProvider,
	XiaohongshuPublishResult,
} from "./provider";
import type {
	UpdateTaskInput,
	XiaohongshuAccountConfigRow,
	XiaohongshuPublisherRepository,
	XiaohongshuPublishTaskRow,
} from "./repository";
import type { CreatePublishTaskInput, XiaohongshuTaskStatus } from "./schema";
import { createPublishTaskInputSchema } from "./schema";

export interface XiaohongshuPublisherService {
	createTask: (
		userId: string,
		input: CreatePublishTaskInput
	) => Promise<XiaohongshuPublishTaskRow>;
	getAccountStatus: (userId: string) => Promise<XiaohongshuAccountConfigRow>;
	getTask: (
		userId: string,
		taskId: string
	) => ReturnType<XiaohongshuPublisherRepository["getTaskWithLogs"]>;
	listTasks: (
		userId: string,
		limit?: number
	) => Promise<XiaohongshuPublishTaskRow[]>;
	publishTask: (
		userId: string,
		taskId: string
	) => Promise<XiaohongshuPublishTaskRow>;
}

export interface XiaohongshuPublisherServiceDependencies {
	provider: XiaohongshuPublishProvider;
	repository: XiaohongshuPublisherRepository;
}

const assertNever = (_value: never): never => {
	throw new Error("Unhandled Xiaohongshu publish result.");
};

const createProviderErrorMessage = (error: unknown): string => {
	if (error instanceof Error && error.message.trim()) {
		return `Provider failed: ${error.message}`;
	}

	return "Provider failed with an unknown error.";
};

const buildPublishInput = (
	task: XiaohongshuPublishTaskRow
): XiaohongshuPublishInput => ({
	content: task.content,
	media: task.media,
	taskId: task.id,
	title: task.title,
	topics: task.topics,
	visibility: task.visibility,
});

const updateTaskOrThrow = async (
	repository: XiaohongshuPublisherRepository,
	taskId: string,
	input: UpdateTaskInput
): Promise<XiaohongshuPublishTaskRow> => {
	const updatedTask = await repository.updateTask(taskId, input);
	if (!updatedTask) {
		throw new Error("Expected publish task update to return a row.");
	}

	return updatedTask;
};

export function createXiaohongshuPublisherService({
	provider,
	repository,
}: XiaohongshuPublisherServiceDependencies): XiaohongshuPublisherService {
	const logTaskStep = (
		taskId: string,
		step: string,
		level: "info" | "warn" | "error",
		message: string,
		metadata: Record<string, unknown> = {}
	) =>
		repository.addTaskLog({
			level,
			message,
			metadata,
			step,
			taskId,
		});

	const markTaskStatus = async (
		taskId: string,
		status: XiaohongshuTaskStatus
	): Promise<void> => {
		await updateTaskOrThrow(repository, taskId, { status });
		await logTaskStep(taskId, status, "info", status);
	};

	const markPublishWorkflowStatuses = async (taskId: string): Promise<void> => {
		await markTaskStatus(taskId, "opening_browser");
		await markTaskStatus(taskId, "checking_login");
		await markTaskStatus(taskId, "uploading_media");
		await markTaskStatus(taskId, "filling_form");
		await markTaskStatus(taskId, "submitting");
	};

	const recordProviderError = async (
		taskId: string,
		error: unknown
	): Promise<XiaohongshuPublishTaskRow> => {
		const errorMessage = createProviderErrorMessage(error);
		const updatedTask = await updateTaskOrThrow(repository, taskId, {
			debugScreenshotPath: null,
			errorCode: "provider_error",
			errorMessage,
			publishedAt: null,
			resultUrl: null,
			status: "failed",
		});
		await logTaskStep(taskId, "failed", "error", errorMessage, {
			errorCode: "provider_error",
			errorMessage,
		});

		return updatedTask;
	};

	const recordActivePublishFailure = async (
		taskId: string,
		error: unknown
	): Promise<XiaohongshuPublishTaskRow> => {
		try {
			return await recordProviderError(taskId, error);
		} catch (recordingError) {
			throw new Error(createProviderErrorMessage(error), {
				cause: recordingError,
			});
		}
	};

	const logTerminalTaskStep = async (
		taskId: string,
		step: string,
		level: "info" | "warn" | "error",
		message: string,
		metadata: Record<string, unknown> = {}
	): Promise<void> => {
		try {
			await logTaskStep(taskId, step, level, message, metadata);
		} catch {
			// Terminal status is already persisted, so keep the publish slot released.
		}
	};

	const updateTaskForFailureResult = (
		taskId: string,
		result: Extract<
			XiaohongshuPublishResult,
			{ status: "failed" | "submitted_unknown" }
		>
	): Promise<XiaohongshuPublishTaskRow> => {
		const debugScreenshotPath = result.debugScreenshotPath ?? null;

		return updateTaskOrThrow(repository, taskId, {
			debugScreenshotPath,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
			publishedAt: null,
			resultUrl: null,
			status: result.status,
		});
	};

	const logFailureResult = (
		taskId: string,
		result: Extract<
			XiaohongshuPublishResult,
			{ status: "failed" | "submitted_unknown" }
		>
	) =>
		logTerminalTaskStep(taskId, result.status, "error", result.errorMessage, {
			debugScreenshotPath: result.debugScreenshotPath ?? null,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});

	return {
		async createTask(
			userId: string,
			input: CreatePublishTaskInput
		): Promise<XiaohongshuPublishTaskRow> {
			const parsedInput = createPublishTaskInputSchema.parse(input);
			const task = await repository.createTask({
				content: parsedInput.content,
				media: parsedInput.media,
				title: parsedInput.title,
				topics: parsedInput.topics,
				userId,
				visibility: parsedInput.visibility,
			});

			await logTaskStep(task.id, "created", "info", "created");

			return task;
		},

		async getAccountStatus(
			userId: string
		): Promise<XiaohongshuAccountConfigRow> {
			const existingConfig = await repository.getAccountConfig(userId);
			if (existingConfig) {
				return existingConfig;
			}

			const session = await provider.checkSession();

			return repository.upsertAccountConfig({
				displayName: session.displayName,
				lastCheckedAt: new Date(),
				profilePath: session.profilePath,
				status: session.status,
				userId,
			});
		},

		getTask(
			userId: string,
			taskId: string
		): ReturnType<XiaohongshuPublisherRepository["getTaskWithLogs"]> {
			return repository.getTaskWithLogs(userId, taskId);
		},

		listTasks(
			userId: string,
			limit = 20
		): Promise<XiaohongshuPublishTaskRow[]> {
			return repository.listTasks(userId, limit);
		},

		async publishTask(
			userId: string,
			taskId: string
		): Promise<XiaohongshuPublishTaskRow> {
			const claimedTask = await repository.claimTaskForPublish(userId, taskId);
			if (!claimedTask) {
				const taskDetails = await repository.getTaskWithLogs(userId, taskId);
				if (!taskDetails) {
					throw new Error("Publish task not found.");
				}

				throw new Error("Publish task is not in a publishable state.");
			}

			let result: XiaohongshuPublishResult;
			try {
				await logTaskStep(claimedTask.id, "validating", "info", "validating");
				await markPublishWorkflowStatuses(claimedTask.id);
				result = await provider.publish(buildPublishInput(claimedTask));
				await markTaskStatus(claimedTask.id, "verifying_result");
			} catch (error) {
				return recordActivePublishFailure(claimedTask.id, error);
			}

			if (result.status === "succeeded") {
				let updatedTask: XiaohongshuPublishTaskRow;
				try {
					updatedTask = await updateTaskOrThrow(repository, claimedTask.id, {
						debugScreenshotPath: null,
						errorCode: null,
						errorMessage: null,
						publishedAt: result.publishedAt,
						resultUrl: result.resultUrl,
						status: "succeeded",
					});
				} catch (error) {
					return recordActivePublishFailure(claimedTask.id, error);
				}
				await logTerminalTaskStep(
					claimedTask.id,
					"succeeded",
					"info",
					"succeeded",
					{
						publishedAt: result.publishedAt.toISOString(),
						resultUrl: result.resultUrl,
					}
				);

				return updatedTask;
			}

			if (result.status === "failed" || result.status === "submitted_unknown") {
				let updatedTask: XiaohongshuPublishTaskRow;
				try {
					updatedTask = await updateTaskForFailureResult(
						claimedTask.id,
						result
					);
				} catch (error) {
					return recordActivePublishFailure(claimedTask.id, error);
				}
				await logFailureResult(claimedTask.id, result);

				return updatedTask;
			}

			return assertNever(result);
		},
	};
}
