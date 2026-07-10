import { env } from "@mercury/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
} from "./schema/auth";
import {
	xhsAccountConfig,
	xhsAccountConfigRelations,
	xhsPublishTask,
	xhsPublishTaskLog,
	xhsPublishTaskLogRelations,
	xhsPublishTaskRelations,
} from "./schema/xiaohongshu-publisher";

const schema = {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
	xhsAccountConfig,
	xhsAccountConfigRelations,
	xhsPublishTask,
	xhsPublishTaskLog,
	xhsPublishTaskLogRelations,
	xhsPublishTaskRelations,
};

export function createDb() {
	return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
