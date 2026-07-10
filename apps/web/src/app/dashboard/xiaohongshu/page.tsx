import { auth } from "@mercury/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import XiaohongshuPublisher from "./xiaohongshu-publisher";

export default async function XiaohongshuPublisherPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/login");
	}

	return <XiaohongshuPublisher />;
}
