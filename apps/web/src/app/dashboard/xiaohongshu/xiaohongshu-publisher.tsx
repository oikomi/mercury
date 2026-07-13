"use client";

import {
	truncateXiaohongshuTitle,
	XIAOHONGSHU_TITLE_MAX_LENGTH,
} from "@mercury/api/routers/xiaohongshu-publisher/constants";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@mercury/ui/components/alert";
import { Badge } from "@mercury/ui/components/badge";
import { Button } from "@mercury/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mercury/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@mercury/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupTextarea,
} from "@mercury/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mercury/ui/components/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@mercury/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CheckCircle2Icon,
	CircleIcon,
	EyeIcon,
	FolderOpenIcon,
	HashIcon,
	LoaderCircleIcon,
	LogInIcon,
	PencilLineIcon,
	RefreshCwIcon,
	SendIcon,
	ShieldCheckIcon,
	SparklesIcon,
	UserRoundIcon,
	XCircleIcon,
} from "lucide-react";
import Image from "next/image";
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
): "destructive" | "outline" | "secondary" | "success" => {
	if (status === "ready" || status === "succeeded") {
		return "success";
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

function AccountToolbar({
	displayName,
	isLoading,
	onRefresh,
	onStartLogin,
	status,
}: AccountCardProps) {
	const statusText = isLoading
		? "检查中…"
		: (accountStatusLabels[status ?? ""] ?? "未知");
	const needsLogin = status !== "ready";

	return (
		<section
			aria-label="发布账号"
			className="flex shrink-0 flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
		>
			<div className="flex min-w-0 items-center gap-3">
				<UserRoundIcon aria-hidden="true" className="size-5 shrink-0" />
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{displayName ?? "我的小红书账号"}
					</p>
					<p className="text-muted-foreground text-xs">发布账号</p>
				</div>
				<div className="shrink-0">
					<Badge variant={getBadgeVariant(status)}>{statusText}</Badge>
				</div>
			</div>
			<div className="flex items-center gap-2 self-end sm:self-auto">
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="重新检测"
									disabled={isLoading}
									onClick={onRefresh}
									size="icon-sm"
									type="button"
									variant="outline"
								>
									<RefreshCwIcon aria-hidden="true" />
								</Button>
							}
						/>
						<TooltipContent>重新检测</TooltipContent>
					</Tooltip>
				</TooltipProvider>
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
			</div>
		</section>
	);
}

function PreflightSummary({ checks }: PreflightCardProps) {
	const completedCount = checks.filter((check) => check.valid).length;

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-2">
			<div className="flex items-center gap-2">
				<ShieldCheckIcon aria-hidden="true" className="size-4" />
				<span className="font-medium text-xs">发布前检查</span>
				<div className="shrink-0">
					<Badge variant="outline">
						{completedCount}/{checks.length}
					</Badge>
				</div>
			</div>
			<ul className="flex flex-wrap gap-2">
				{checks.map((check) => (
					<li key={check.id}>
						<Badge variant={check.valid ? "success" : "secondary"}>
							{check.valid ? (
								<CheckCircle2Icon aria-hidden="true" />
							) : (
								<CircleIcon aria-hidden="true" />
							)}
							{check.label}
						</Badge>
					</li>
				))}
			</ul>
		</div>
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
	const normalizedTitle = title.trim();
	const checks: PreflightCheck[] = [
		{
			id: "title",
			label: "标题",
			valid:
				normalizedTitle.length > 0 &&
				normalizedTitle.length <= XIAOHONGSHU_TITLE_MAX_LENGTH,
		},
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
	const completedCheckCount = checks.filter((check) => check.valid).length;
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
		setTitle(truncateXiaohongshuTitle(draft.title));
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
		<main
			className="h-svh overflow-hidden bg-background"
			id="main-content"
			tabIndex={-1}
		>
			<div className="mx-auto flex h-full min-h-0 w-full max-w-[1480px] flex-col gap-4 px-4 py-3 md:px-6 md:py-4">
				<header className="flex shrink-0 items-center gap-3 py-1">
					<Image
						alt=""
						aria-hidden="true"
						className="size-9 shrink-0 md:size-10"
						height={40}
						priority
						src="/mercury-mark.svg"
						width={40}
					/>
					<h1 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-balance">
						<span className="font-bold text-xl md:text-2xl" translate="no">
							Mercury
						</span>
						<span className="font-medium text-muted-foreground text-sm md:text-base">
							小红书发布台
						</span>
					</h1>
				</header>

				<AccountToolbar
					displayName={accountStatus.data?.displayName}
					isLoading={isAccountBusy}
					onRefresh={handleRefreshAccount}
					onStartLogin={handleStartLogin}
					status={accountStatus.data?.status}
				/>

				{feedback ? (
					<Alert
						variant={feedback.kind === "error" ? "destructive" : "default"}
					>
						{feedback.kind === "success" ? (
							<CheckCircle2Icon aria-hidden="true" />
						) : (
							<XCircleIcon aria-hidden="true" />
						)}
						<AlertTitle>{feedback.title}</AlertTitle>
						<AlertDescription>{feedback.description}</AlertDescription>
					</Alert>
				) : null}

				<form
					className="min-h-0 flex-1 overflow-y-auto xl:overflow-hidden"
					onSubmit={handlePublish}
				>
					<div className="grid min-h-full items-stretch gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(380px,0.9fr)_minmax(560px,1.1fr)]">
						<Card className="h-full min-h-0" size="sm">
							<CardHeader className="border-b">
								<CardTitle className="flex items-center gap-2">
									<SparklesIcon aria-hidden="true" className="size-4" />
									素材与 AI
								</CardTitle>
								<CardDescription>内容截图</CardDescription>
								<CardAction>
									<Badge variant="secondary">AI · MAX</Badge>
								</CardAction>
							</CardHeader>
							<CardContent className="min-h-0 flex-1 overflow-y-auto">
								<ScreenshotDraftGenerator
									disabled={isPublishing}
									onGenerate={generateDraft.mutateAsync}
									onGenerated={handleGeneratedDraft}
									onMediaInvalidated={() => setGeneratedMediaPath("")}
								/>
							</CardContent>
						</Card>

						<Card className="h-full min-h-0" size="sm">
							<CardHeader className="border-b">
								<CardTitle className="flex items-center gap-2">
									<PencilLineIcon aria-hidden="true" className="size-4" />
									发布内容
								</CardTitle>
								<CardDescription>图文笔记</CardDescription>
								<CardAction>
									<Badge variant={canPublish ? "success" : "secondary"}>
										{completedCheckCount}/{checks.length} 已就绪
									</Badge>
								</CardAction>
							</CardHeader>
							<CardContent className="min-h-0 flex-1 overflow-y-auto">
								<FieldGroup>
									<Field>
										<FieldLabel htmlFor="xhs-title">标题</FieldLabel>
										<InputGroup>
											<InputGroupInput
												autoComplete="off"
												id="xhs-title"
												maxLength={XIAOHONGSHU_TITLE_MAX_LENGTH}
												name="title"
												onChange={(event) => setTitle(event.target.value)}
												placeholder="输入笔记标题…"
												value={title}
											/>
											<InputGroupAddon align="inline-start">
												<PencilLineIcon aria-hidden="true" />
											</InputGroupAddon>
											<InputGroupAddon
												align="inline-end"
												aria-live="polite"
												className="tabular-nums"
											>
												{title.length}/{XIAOHONGSHU_TITLE_MAX_LENGTH}
											</InputGroupAddon>
										</InputGroup>
									</Field>

									<Field>
										<FieldLabel htmlFor="xhs-content">正文</FieldLabel>
										<InputGroup>
											<InputGroupTextarea
												autoComplete="off"
												className="min-h-[clamp(180px,23svh,220px)] resize-y"
												id="xhs-content"
												maxLength={5000}
												name="content"
												onChange={(event) => setContent(event.target.value)}
												placeholder="输入正文…"
												value={content}
											/>
											<InputGroupAddon
												align="block-end"
												className="justify-end"
											>
												<span className="tabular-nums">
													{content.length}/5000
												</span>
											</InputGroupAddon>
										</InputGroup>
									</Field>

									<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
										<Field>
											<FieldLabel htmlFor="xhs-topics">话题</FieldLabel>
											<InputGroup>
												<InputGroupInput
													autoComplete="off"
													id="xhs-topics"
													name="topics"
													onChange={(event) => setTopics(event.target.value)}
													placeholder="例如：#咖啡 #探店…"
													value={topics}
												/>
												<InputGroupAddon align="inline-start">
													<HashIcon aria-hidden="true" />
												</InputGroupAddon>
											</InputGroup>
										</Field>
										<Field>
											<FieldLabel htmlFor="xhs-visibility">可见性</FieldLabel>
											<Select
												name="visibility"
												onValueChange={handleVisibilityChange}
												value={visibility}
											>
												<SelectTrigger className="w-full" id="xhs-visibility">
													<EyeIcon aria-hidden="true" />
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
										<InputGroup>
											<InputGroupInput
												autoComplete="off"
												id="xhs-media-path"
												name="mediaPath"
												onChange={(event) => setMediaPath(event.target.value)}
												placeholder="例如：/Users/name/Pictures/note.png…"
												value={mediaPath}
											/>
											<InputGroupAddon align="inline-start">
												<FolderOpenIcon aria-hidden="true" />
											</InputGroupAddon>
										</InputGroup>
									</Field>
								</FieldGroup>
							</CardContent>
							<CardFooter className="flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
								<PreflightSummary checks={checks} />
								<Button
									className="w-full shrink-0 sm:w-auto"
									disabled={!canPublish || isPublishing}
									type="submit"
								>
									{isPublishing ? (
										<LoaderCircleIcon
											aria-hidden="true"
											className="animate-spin"
											data-icon="inline-start"
										/>
									) : (
										<SendIcon aria-hidden="true" data-icon="inline-start" />
									)}
									{isPublishing ? "发布中…" : "发布到小红书"}
								</Button>
							</CardFooter>
						</Card>
					</div>
				</form>
			</div>
		</main>
	);
}
