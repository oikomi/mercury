import { auth } from "@mercury/auth";
import { buttonVariants } from "@mercury/ui/components/button";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect("/login");
	}

	return (
		<div>
			<h1>Dashboard</h1>
			<p>Welcome {session.user.name}</p>
			<Dashboard />
			<Link
				className={buttonVariants({ variant: "outline" })}
				href="/dashboard/xiaohongshu"
			>
				打开小红书发布台
			</Link>
		</div>
	);
}
