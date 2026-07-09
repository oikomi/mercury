import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	xhsAccountConfig,
	xhsAccountConfigRelations,
	xhsPublishTask,
	xhsPublishTaskLog,
	xhsPublishTaskLogRelations,
	xhsPublishTaskRelations,
} from "@mercury/db/schema/xiaohongshu-publisher";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { activeXiaohongshuPublishTaskStatuses } from "./repository";

const migrationsDirectory = join(process.cwd(), "packages/db/src/migrations");

const hasColumnName = (value: unknown): value is { name: string } => {
	if (typeof value !== "object" || value === null || !("name" in value)) {
		return false;
	}

	const { name } = value as { name: unknown };
	return typeof name === "string";
};

const getIndexColumnName = (column: unknown): string => {
	if (hasColumnName(column)) {
		return column.name;
	}

	throw new Error("Expected index column to expose a string name.");
};

const getMigrationSql = (): string =>
	readdirSync(migrationsDirectory)
		.filter((fileName) => fileName.endsWith(".sql"))
		.sort()
		.map((fileName) =>
			readFileSync(join(migrationsDirectory, fileName), "utf8")
		)
		.join("\n");

describe("xiaohongshu publisher database schema", () => {
	it("exports the expected table names", () => {
		expect(getTableName(xhsAccountConfig)).toBe("xhs_account_config");
		expect(getTableName(xhsPublishTask)).toBe("xhs_publish_task");
		expect(getTableName(xhsPublishTaskLog)).toBe("xhs_publish_task_log");
	});

	it("exports the expected relations", () => {
		expect(xhsAccountConfigRelations).toBeDefined();
		expect(xhsPublishTaskRelations).toBeDefined();
		expect(xhsPublishTaskLogRelations).toBeDefined();
	});

	it("keeps foreign keys cascading on delete", () => {
		const accountForeignKeys = getTableConfig(xhsAccountConfig).foreignKeys.map(
			(foreignKey) => {
				const reference = foreignKey.reference();

				return {
					columns: reference.columns.map((column) => column.name),
					foreignColumns: reference.foreignColumns.map((column) => column.name),
					foreignTable: getTableName(reference.foreignTable),
					onDelete: foreignKey.onDelete,
				};
			}
		);
		const taskForeignKeys = getTableConfig(xhsPublishTask).foreignKeys.map(
			(foreignKey) => {
				const reference = foreignKey.reference();

				return {
					columns: reference.columns.map((column) => column.name),
					foreignColumns: reference.foreignColumns.map((column) => column.name),
					foreignTable: getTableName(reference.foreignTable),
					onDelete: foreignKey.onDelete,
				};
			}
		);
		const logForeignKeys = getTableConfig(xhsPublishTaskLog).foreignKeys.map(
			(foreignKey) => {
				const reference = foreignKey.reference();

				return {
					columns: reference.columns.map((column) => column.name),
					foreignColumns: reference.foreignColumns.map((column) => column.name),
					foreignTable: getTableName(reference.foreignTable),
					onDelete: foreignKey.onDelete,
				};
			}
		);

		expect(accountForeignKeys).toContainEqual({
			columns: ["user_id"],
			foreignColumns: ["id"],
			foreignTable: "user",
			onDelete: "cascade",
		});
		expect(taskForeignKeys).toContainEqual({
			columns: ["user_id"],
			foreignColumns: ["id"],
			foreignTable: "user",
			onDelete: "cascade",
		});
		expect(logForeignKeys).toContainEqual({
			columns: ["task_id"],
			foreignColumns: ["id"],
			foreignTable: "xhs_publish_task",
			onDelete: "cascade",
		});
	});

	it("keeps account config unique per user", () => {
		const { indexes } = getTableConfig(xhsAccountConfig);
		const indexConfigs = indexes.map((index) => ({
			columns: index.config.columns.map(getIndexColumnName),
			name: index.config.name,
			unique: index.config.unique,
		}));

		expect(indexConfigs).toContainEqual({
			columns: ["user_id"],
			name: "xhs_account_config_user_id_unique",
			unique: true,
		});
		expect(indexConfigs).toContainEqual({
			columns: ["status"],
			name: "xhs_account_config_status_idx",
			unique: false,
		});
	});

	it("keeps publish task lookup indexes", () => {
		const { indexes } = getTableConfig(xhsPublishTask);
		const indexConfigs = indexes.map((index) => ({
			columns: index.config.columns.map(getIndexColumnName),
			name: index.config.name,
			unique: index.config.unique,
			where: index.config.where,
		}));

		expect(indexConfigs).toEqual(
			expect.arrayContaining([
				{
					columns: ["user_id"],
					name: "xhs_publish_task_user_id_idx",
					unique: false,
				},
				{
					columns: ["status"],
					name: "xhs_publish_task_status_idx",
					unique: false,
				},
				{
					columns: ["created_at"],
					name: "xhs_publish_task_created_at_idx",
					unique: false,
				},
			])
		);
		expect(indexConfigs).toContainEqual({
			columns: ["user_id"],
			name: "xhs_publish_task_active_user_unique",
			unique: true,
			where: expect.anything(),
		});
	});

	it("creates a partial unique index for one active publish task per user", () => {
		const migrationSql = getMigrationSql();

		expect(migrationSql).toContain(
			'CREATE UNIQUE INDEX "xhs_publish_task_active_user_unique"'
		);
		expect(migrationSql).toContain("WHERE");
		for (const status of activeXiaohongshuPublishTaskStatuses) {
			expect(migrationSql).toContain(status);
		}
	});

	it("keeps publish task log lookup indexes", () => {
		const { indexes } = getTableConfig(xhsPublishTaskLog);
		const indexConfigs = indexes.map((index) => ({
			columns: index.config.columns.map(getIndexColumnName),
			name: index.config.name,
			unique: index.config.unique,
		}));

		expect(indexConfigs).toEqual(
			expect.arrayContaining([
				{
					columns: ["task_id"],
					name: "xhs_publish_task_log_task_id_idx",
					unique: false,
				},
				{
					columns: ["created_at"],
					name: "xhs_publish_task_log_created_at_idx",
					unique: false,
				},
			])
		);
	});

	it("uses enum-backed account status with a not configured default", () => {
		const { columns } = getTableConfig(xhsAccountConfig);
		const status = columns.find((column) => column.name === "status");

		expect(status).toMatchObject({
			columnType: "PgEnumColumn",
			default: "not_configured",
			enumValues: [
				"not_configured",
				"login_required",
				"ready",
				"expired",
				"error",
			],
			notNull: true,
		});
	});

	it("uses enum-backed publish task status with a created default", () => {
		const { columns } = getTableConfig(xhsPublishTask);
		const status = columns.find((column) => column.name === "status");

		expect(status).toMatchObject({
			columnType: "PgEnumColumn",
			default: "created",
			enumValues: [
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
			],
			notNull: true,
		});
	});

	it("uses enum-backed publish task visibility with a public default", () => {
		const { columns } = getTableConfig(xhsPublishTask);
		const visibility = columns.find((column) => column.name === "visibility");

		expect(visibility).toMatchObject({
			columnType: "PgEnumColumn",
			default: "public",
			enumValues: ["public", "private", "followers"],
			notNull: true,
		});
	});

	it("uses enum-backed task log level with an info default", () => {
		const { columns } = getTableConfig(xhsPublishTaskLog);
		const level = columns.find((column) => column.name === "level");

		expect(level).toMatchObject({
			columnType: "PgEnumColumn",
			default: "info",
			enumValues: ["info", "warn", "error"],
			notNull: true,
		});
	});

	it("keeps publish task JSON columns and result fields", () => {
		const { columns } = getTableConfig(xhsPublishTask);
		const media = columns.find((column) => column.name === "media");
		const topics = columns.find((column) => column.name === "topics");
		const columnNames = columns.map((column) => column.name);

		expect(media).toMatchObject({
			columnType: "PgJsonb",
			notNull: true,
		});
		expect(topics).toMatchObject({
			columnType: "PgJsonb",
			default: [],
			notNull: true,
		});
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"result_url",
				"error_code",
				"error_message",
				"debug_screenshot_path",
			])
		);
	});

	it("requires task log metadata and defaults it to an object", () => {
		const { columns } = getTableConfig(xhsPublishTaskLog);
		const metadata = columns.find((column) => column.name === "metadata");

		expect(metadata).toMatchObject({
			columnType: "PgJsonb",
			default: {},
			notNull: true,
		});
	});
});
