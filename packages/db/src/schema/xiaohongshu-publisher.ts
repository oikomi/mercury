import { relations, sql } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const xhsAccountStatus = pgEnum("xhs_account_status", [
	"not_configured",
	"login_required",
	"ready",
	"expired",
	"error",
]);

export const xhsTaskStatus = pgEnum("xhs_task_status", [
	"created",
	"validating",
	"opening_browser",
	"checking_login",
	"uploading_media",
	"filling_form",
	"submitting",
	"verifying_result",
	"succeeded",
	"failed",
	"submitted_unknown",
]);

export const xhsTaskLogLevel = pgEnum("xhs_task_log_level", [
	"info",
	"warn",
	"error",
]);

export const xhsVisibility = pgEnum("xhs_visibility", [
	"public",
	"private",
	"followers",
]);

export const xhsAccountConfig = pgTable(
	"xhs_account_config",
	{
		createdAt: timestamp("created_at").defaultNow().notNull(),
		displayName: text("display_name"),
		id: text("id").primaryKey(),
		lastCheckedAt: timestamp("last_checked_at"),
		lastLoginAt: timestamp("last_login_at"),
		profilePath: text("profile_path"),
		status: xhsAccountStatus("status").default("not_configured").notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("xhs_account_config_user_id_unique").on(table.userId),
		index("xhs_account_config_status_idx").on(table.status),
	]
);

export const xhsPublishTask = pgTable(
	"xhs_publish_task",
	{
		content: text("content").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		debugScreenshotPath: text("debug_screenshot_path"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		id: text("id").primaryKey(),
		media: jsonb("media")
			.$type<
				Array<{
					mimeType: string;
					name: string;
					path: string;
					size: number;
					type: "image" | "video";
				}>
			>()
			.notNull(),
		publishedAt: timestamp("published_at"),
		resultUrl: text("result_url"),
		status: xhsTaskStatus("status").default("created").notNull(),
		title: text("title").notNull(),
		topics: jsonb("topics").$type<string[]>().default([]).notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		visibility: xhsVisibility("visibility").default("public").notNull(),
	},
	(table) => [
		index("xhs_publish_task_user_id_idx").on(table.userId),
		index("xhs_publish_task_status_idx").on(table.status),
		index("xhs_publish_task_created_at_idx").on(table.createdAt),
		uniqueIndex("xhs_publish_task_active_user_unique")
			.on(table.userId)
			.where(
				sql`${table.status} in ('validating', 'opening_browser', 'checking_login', 'uploading_media', 'filling_form', 'submitting', 'verifying_result')`
			),
	]
);

export const xhsPublishTaskLog = pgTable(
	"xhs_publish_task_log",
	{
		createdAt: timestamp("created_at").defaultNow().notNull(),
		id: text("id").primaryKey(),
		level: xhsTaskLogLevel("level").default("info").notNull(),
		message: text("message").notNull(),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		step: text("step").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => xhsPublishTask.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("xhs_publish_task_log_task_id_idx").on(table.taskId),
		index("xhs_publish_task_log_created_at_idx").on(table.createdAt),
	]
);

export const xhsAccountConfigRelations = relations(
	xhsAccountConfig,
	({ one }) => ({
		user: one(user, {
			fields: [xhsAccountConfig.userId],
			references: [user.id],
		}),
	})
);

export const xhsPublishTaskRelations = relations(
	xhsPublishTask,
	({ many, one }) => ({
		logs: many(xhsPublishTaskLog),
		user: one(user, {
			fields: [xhsPublishTask.userId],
			references: [user.id],
		}),
	})
);

export const xhsPublishTaskLogRelations = relations(
	xhsPublishTaskLog,
	({ one }) => ({
		task: one(xhsPublishTask, {
			fields: [xhsPublishTaskLog.taskId],
			references: [xhsPublishTask.id],
		}),
	})
);
