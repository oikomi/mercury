import { randomUUID } from "node:crypto";

import type {
	XiaohongshuAccountStatus,
	XiaohongshuMedia,
	XiaohongshuTaskStatus,
	XiaohongshuVisibility,
} from "./schema";

export type XiaohongshuTaskLogLevel = "info" | "warn" | "error";

export interface XiaohongshuAccountConfigRow {
	createdAt: Date;
	displayName: string | null;
	id: string;
	lastCheckedAt: Date | null;
	lastLoginAt: Date | null;
	profilePath: string | null;
	status: XiaohongshuAccountStatus;
	updatedAt: Date;
	userId: string;
}

export interface XiaohongshuPublishTaskRow {
	content: string;
	createdAt: Date;
	debugScreenshotPath: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	id: string;
	media: XiaohongshuMedia[];
	publishedAt: Date | null;
	resultUrl: string | null;
	status: XiaohongshuTaskStatus;
	title: string;
	topics: string[];
	updatedAt: Date;
	userId: string;
	visibility: XiaohongshuVisibility;
}

export interface XiaohongshuPublishTaskLogRow {
	createdAt: Date;
	id: string;
	level: XiaohongshuTaskLogLevel;
	message: string;
	metadata: Record<string, unknown>;
	step: string;
	taskId: string;
}

export interface CreateTaskRepositoryInput {
	content: string;
	media: readonly XiaohongshuMedia[];
	title: string;
	topics: readonly string[];
	userId: string;
	visibility: XiaohongshuVisibility;
}

export interface AddTaskLogInput {
	level: XiaohongshuTaskLogLevel;
	message: string;
	metadata: Record<string, unknown>;
	step: string;
	taskId: string;
}

export interface UpdateTaskInput {
	debugScreenshotPath?: string | null;
	errorCode?: string | null;
	errorMessage?: string | null;
	publishedAt?: Date | null;
	resultUrl?: string | null;
	status?: XiaohongshuTaskStatus;
}

export interface UpsertAccountConfigInput {
	displayName?: string | null;
	lastCheckedAt?: Date | null;
	lastLoginAt?: Date | null;
	profilePath?: string | null;
	status?: XiaohongshuAccountStatus;
	userId: string;
}

export interface XiaohongshuPublisherRepository {
	addTaskLog: (input: AddTaskLogInput) => Promise<XiaohongshuPublishTaskLogRow>;
	createTask: (
		input: CreateTaskRepositoryInput
	) => Promise<XiaohongshuPublishTaskRow>;
	getAccountConfig: (
		userId: string
	) => Promise<XiaohongshuAccountConfigRow | null>;
	getTaskWithLogs: (
		userId: string,
		taskId: string
	) => Promise<{
		logs: XiaohongshuPublishTaskLogRow[];
		task: XiaohongshuPublishTaskRow;
	} | null>;
	listTasks: (
		userId: string,
		limit: number
	) => Promise<XiaohongshuPublishTaskRow[]>;
	updateTask: (
		taskId: string,
		input: UpdateTaskInput
	) => Promise<XiaohongshuPublishTaskRow | null>;
	upsertAccountConfig: (
		input: UpsertAccountConfigInput
	) => Promise<XiaohongshuAccountConfigRow>;
}

export function createId(prefix: string): string {
	return `${prefix}_${randomUUID()}`;
}
