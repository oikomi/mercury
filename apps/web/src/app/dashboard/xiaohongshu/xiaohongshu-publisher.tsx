"use client";

import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@mercury/ui/components/alert";
import { Badge } from "@mercury/ui/components/badge";
import { Button, buttonVariants } from "@mercury/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mercury/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@mercury/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@mercury/ui/components/field";
import { Input } from "@mercury/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mercury/ui/components/select";
import { Textarea } from "@mercury/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowLeftIcon,
	CheckCircle2Icon,
	CircleIcon,
	Clock3Icon,
	FileImageIcon,
	LogInIcon,
	RefreshCwIcon,
	SendIcon,
	ShieldCheckIcon,
	UserRoundIcon,
	XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { queryClient, trpc } from "@/utils/trpc";

import ScreenshotDraftGenerator, {
	type GeneratedDraft,
} from "./screenshot-draft-generator";

const TOPIC_SEPARATOR_PATTERN = /[,\s，]+/u;
const PATH_SEPARATOR_PATTERN = /[\\/]/u;

const visibilityOptions = [
	{ label: "公开", value: "public" },
	{ label: "仅自己", value: "private" },
	{ label: "粉丝可见", value: "followers" },
] as const;

const taskStatusLabels: Record<string, string> = {
	checking_login: "检查登录",
	created: "待发布",
	failed: "失败",
	filling_form: "填写内容",
	opening_browser: "打开浏览器",
	submitted_unknown: "待确认",
	submitting: "提交中",
	succeeded: "已发布",
	uploading_media: "上传媒体",
	validating: "校验中",
	verifying_result: "确认结果",
};

type Visibility = (typeof visibilityOptions)[number]["value"];

interface FeedbackState {
	description: string;
	kind: "error" | "success";
	title: string;
}

interface PreflightCheck {
	id: string;
	label: string;
	valid: boolean;
}

interface AccountCardProps {
	displayName: string | null | undefined;
	isLoading: boolean;
	onRefresh: () => Promise<void>;
	onStartLogin: () => Promise<void>;
	status: string | undefined;
}

interface PreflightCardProps {
	checks: PreflightCheck[];
}

interface RecentTask {
	id: string;
	status: string;
	title: string;
}

interface RecentTasksCardProps {
	isLoading: boolean;
	tasks: RecentTask[];
}

const parseTopics = (value: string): string[] =>
	value
		.split(TOPIC_SEPARATOR_PATTERN)
		.map((topic) => topic.trim())
		.filter(Boolean);

const getFileName = (mediaPath: string): string =>
	mediaPath.split(PATH_SEPARATOR_PATTERN).at(-1) ?? "media";

const getErrorMessage = (error: unknown): string =>
	error instanceof Error && error.message.trim()
		? error.message
		: "发布请求失败，请稍后重试。";

const getBadgeVariant = (
	status: string | undefined
): "default" | "destructive" | "outline" | "secondary" => {
	if (status === "ready" || status === "succeeded") {
		return "default";
	}

	if (status === "error" || status === "expired" || status === "failed") {
		return "destructive";
	}

	return status ? "secondary" : "outline";
};

const accountStatusLabels: Record<string, string> = {
	error: "检测失败",
	expired: "登录过期",
	login_required: "需要登录",
	not_configured: "未配置",
	ready: "已就绪",
};

function AccountCard({
	displayName,
	isLoading,
	onRefresh,
	onStartLogin,
	status,
}: AccountCardProps) {
	const statusText = isLoading
		? "检查中"
		: (accountStatusLabels[status ?? ""] ?? "未知");
	const needsLogin = status !== "ready";

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<UserRoundIcon aria-hidden="true" className="size-4" />
					发布账号
				</CardTitle>
				<CardDescription>{displayName ?? "我的小红书账号"}</CardDescription>
				<CardAction>
					<Badge variant={getBadgeVariant(status)}>{statusText}</Badge>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-wrap gap-2">
				<Button
					disabled={isLoading}
					onClick={onRefresh}
					size="xs"
					type="button"
					variant="outline"
				>
					<RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
					重新检测
				</Button>
				{needsLogin ? (
					<Button
						disabled={isLoading}
						onClick={onStartLogin}
						size="xs"
						type="button"
					>
						<LogInIcon aria-hidden="true" data-icon="inline-start" />
						打开登录窗口
					</Button>
				) : null}
			</CardContent>
		</Card>
	);
}

function PreflightCard({ checks }: PreflightCardProps) {
	const completedCount = checks.filter((check) => check.valid).length;

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<ShieldCheckIcon aria-hidden="true" className="size-4" />
					发布前检查
				</CardTitle>
				<CardAction>
					<Badge variant="outline">
						{completedCount}/{checks.length}
					</Badge>
				</CardAction>
			</CardHeader>
			<CardContent>
				<ul className="flex flex-col gap-2">
					{checks.map((check) => (
						<li className="flex items-center gap-2 text-xs" key={check.id}>
							{check.valid ? (
								<CheckCircle2Icon
									aria-hidden="true"
									className="size-4 text-primary"
								/>
							) : (
								<CircleIcon
									aria-hidden="true"
									className="size-4 text-muted-foreground"
								/>
							)}
							<span
								className={check.valid ? undefined : "text-muted-foreground"}
							>
								{check.label}
							</span>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

function RecentTasksCard({ isLoading, tasks }: RecentTasksCardProps) {
	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Clock3Icon aria-hidden="true" className="size-4" />
					最近任务
				</CardTitle>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<p className="text-muted-foreground text-xs">加载中</p>
				) : null}
				{!isLoading && tasks.length === 0 ? (
					<Empty className="min-h-32 p-4">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FileImageIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>暂无发布任务</EmptyTitle>
							<EmptyDescription>新任务将显示在这里。</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : null}
				{tasks.length > 0 ? (
					<ul className="divide-y">
						{tasks.map((task) => (
							<li className="flex items-center gap-3 py-2" key={task.id}>
								<span className="min-w-0 flex-1 truncate text-xs">
									{task.title}
								</span>
								<Badge variant={getBadgeVariant(task.status)}>
									{taskStatusLabels[task.status] ?? task.status}
								</Badge>
							</li>
						))}
					</ul>
				) : null}
			</CardContent>
		</Card>
	);
}

export default function XiaohongshuPublisher() {
	const [content, setContent] = useState("");
	const [feedback, setFeedback] = useState<FeedbackState | null>(null);
	const [generatedMediaPath, setGeneratedMediaPath] = useState("");
	const [mediaPath, setMediaPath] = useState("");
	const [title, setTitle] = useState("");
	const [topics, setTopics] = useState("");
	const [visibility, setVisibility] = useState<Visibility>("public");

	const accountStatus = useQuery(
		trpc.xiaohongshuPublisher.getAccountStatus.queryOptions()
	);
	const tasks = useQuery(
		trpc.xiaohongshuPublisher.listTasks.queryOptions({ limit: 5 })
	);
	const createTask = useMutation(
		trpc.xiaohongshuPublisher.createTask.mutationOptions()
	);
	const generateDraft = useMutation(
		trpc.xiaohongshuPublisher.generateDraft.mutationOptions()
	);
	const publishTask = useMutation(
		trpc.xiaohongshuPublisher.publishTask.mutationOptions()
	);
	const refreshAccountStatus = useMutation(
		trpc.xiaohongshuPublisher.refreshAccountStatus.mutationOptions()
	);
	const startLogin = useMutation(
		trpc.xiaohongshuPublisher.startLogin.mutationOptions()
	);

	const effectiveMediaPath = generatedMediaPath.trim() || mediaPath.trim();
	const checks: PreflightCheck[] = [
		{ id: "title", label: "标题", valid: title.trim().length > 0 },
		{ id: "content", label: "正文", valid: content.trim().length > 0 },
		{
			id: "media",
			label: "媒体素材",
			valid: effectiveMediaPath.length > 0,
		},
		{
			id: "account",
			label: "账号会话",
			valid: accountStatus.data?.status === "ready",
		},
	];
	const canPublish = checks.every((check) => check.valid);
	const isPublishing = createTask.isPending || publishTask.isPending;
	const isAccountBusy =
		accountStatus.isLoading ||
		refreshAccountStatus.isPending ||
		startLogin.isPending;

	const runAccountAction = async (
		action: () => Promise<unknown>
	): Promise<void> => {
		setFeedback(null);
		try {
			await action();
			await queryClient.invalidateQueries();
		} catch (error) {
			setFeedback({
				description: getErrorMessage(error),
				kind: "error",
				title: "账号操作失败",
			});
		}
	};

	const handleRefreshAccount = (): Promise<void> =>
		runAccountAction(() => refreshAccountStatus.mutateAsync());

	const handleStartLogin = (): Promise<void> =>
		runAccountAction(() => startLogin.mutateAsync());

	const handleGeneratedDraft = (draft: GeneratedDraft): void => {
		setContent(draft.content);
		setGeneratedMediaPath(draft.mediaPath);
		setTitle(draft.title);
		setTopics(draft.topics.map((topic) => `#${topic}`).join(" "));
	};

	const selectedVisibilityLabel =
		visibilityOptions.find((option) => option.value === visibility)?.label ??
		"公开";

	const handleVisibilityChange = (value: string | null) => {
		if (value === "public" || value === "private" || value === "followers") {
			setVisibility(value);
		}
	};

	const handlePublish = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canPublish || isPublishing) {
			return;
		}

		setFeedback(null);
		try {
			const normalizedMediaPath = effectiveMediaPath;
			const isVideo = normalizedMediaPath.toLowerCase().endsWith(".mp4");
			const task = await createTask.mutateAsync({
				content,
				media: [
					{
						mimeType: isVideo ? "video/mp4" : "image/png",
						name: getFileName(normalizedMediaPath),
						path: normalizedMediaPath,
						size: 1,
						type: isVideo ? "video" : "image",
					},
				],
				title,
				topics: parseTopics(topics),
				visibility,
			});
			const publishedTask = await publishTask.mutateAsync({ taskId: task.id });
			await queryClient.invalidateQueries();

			if (publishedTask.status === "succeeded") {
				setFeedback({
					description: publishedTask.resultUrl ?? "任务已完成。",
					kind: "success",
					title: "发布成功",
				});
				return;
			}

			setFeedback({
				description: publishedTask.errorMessage ?? "发布结果需要人工确认。",
				kind: "error",
				title: "发布未完成",
			});
		} catch (error) {
			setFeedback({
				description: getErrorMessage(error),
				kind: "error",
				title: "发布失败",
			});
		}
	};

	return (
		<main className="h-full overflow-y-auto bg-background">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 md:px-6 md:py-7">
				<header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
					<div className="flex flex-col gap-2">
						<Link
							className={buttonVariants({ size: "xs", variant: "ghost" })}
							href="/dashboard"
						>
							<ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
							Dashboard
						</Link>
						<h1 className="font-semibold text-2xl">小红书发布台</h1>
					</div>
					<Badge variant={getBadgeVariant(accountStatus.data?.status)}>
						{accountStatus.isLoading
							? "检查账号"
							: (accountStatusLabels[accountStatus.data?.status ?? ""] ??
								"账号未知")}
					</Badge>
				</header>

				<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
					<form onSubmit={handlePublish}>
						<Card>
							<CardHeader>
								<CardTitle>新建发布任务</CardTitle>
								<CardDescription>图文与视频笔记</CardDescription>
							</CardHeader>
							<CardContent>
								<FieldGroup>
									<ScreenshotDraftGenerator
										disabled={isPublishing}
										onGenerate={generateDraft.mutateAsync}
										onGenerated={handleGeneratedDraft}
										onMediaInvalidated={() => setGeneratedMediaPath("")}
									/>
									<Field>
										<FieldLabel htmlFor="xhs-title">标题</FieldLabel>
										<Input
											id="xhs-title"
											maxLength={60}
											onChange={(event) => setTitle(event.target.value)}
											placeholder="输入笔记标题"
											value={title}
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="xhs-content">正文</FieldLabel>
										<Textarea
											className="min-h-40 resize-y"
											id="xhs-content"
											maxLength={5000}
											onChange={(event) => setContent(event.target.value)}
											placeholder="输入正文"
											value={content}
										/>
									</Field>
									<div className="grid gap-4 md:grid-cols-2">
										<Field>
											<FieldLabel htmlFor="xhs-topics">话题</FieldLabel>
											<Input
												id="xhs-topics"
												onChange={(event) => setTopics(event.target.value)}
												placeholder="#咖啡 #探店"
												value={topics}
											/>
										</Field>
										<Field>
											<FieldLabel htmlFor="xhs-visibility">可见性</FieldLabel>
											<Select
												onValueChange={handleVisibilityChange}
												value={visibility}
											>
												<SelectTrigger className="w-full" id="xhs-visibility">
													<SelectValue>{selectedVisibilityLabel}</SelectValue>
												</SelectTrigger>
												<SelectContent>
													<SelectGroup>
														{visibilityOptions.map((option) => (
															<SelectItem
																key={option.value}
																value={option.value}
															>
																{option.label}
															</SelectItem>
														))}
													</SelectGroup>
												</SelectContent>
											</Select>
										</Field>
									</div>
									<Field>
										<FieldLabel htmlFor="xhs-media-path">
											本机媒体路径（可选）
										</FieldLabel>
										<Input
											id="xhs-media-path"
											onChange={(event) => setMediaPath(event.target.value)}
											placeholder="/Users/name/Pictures/note.png"
											value={mediaPath}
										/>
									</Field>
								</FieldGroup>
							</CardContent>
							{feedback ? (
								<CardContent>
									<Alert
										variant={
											feedback.kind === "error" ? "destructive" : "default"
										}
									>
										{feedback.kind === "success" ? (
											<CheckCircle2Icon aria-hidden="true" />
										) : (
											<XCircleIcon aria-hidden="true" />
										)}
										<AlertTitle>{feedback.title}</AlertTitle>
										<AlertDescription>{feedback.description}</AlertDescription>
									</Alert>
								</CardContent>
							) : null}
							<CardFooter className="justify-end">
								<Button disabled={!canPublish || isPublishing} type="submit">
									<SendIcon aria-hidden="true" data-icon="inline-start" />
									{isPublishing ? "发布中" : "发布到小红书"}
								</Button>
							</CardFooter>
						</Card>
					</form>

					<aside className="flex flex-col gap-4">
						<AccountCard
							displayName={accountStatus.data?.displayName}
							isLoading={isAccountBusy}
							onRefresh={handleRefreshAccount}
							onStartLogin={handleStartLogin}
							status={accountStatus.data?.status}
						/>
						<PreflightCard checks={checks} />
						<RecentTasksCard
							isLoading={tasks.isLoading}
							tasks={tasks.data ?? []}
						/>
					</aside>
				</div>
			</div>
		</main>
	);
}
