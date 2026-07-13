"use client";

import {
	XIAOHONGSHU_DRAFT_STYLE_VALUES,
	type XiaohongshuDraftStyle,
} from "@mercury/api/routers/xiaohongshu-publisher/constants";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@mercury/ui/components/alert";
import {
	Attachment,
	AttachmentAction,
	AttachmentActions,
	AttachmentContent,
	AttachmentDescription,
	AttachmentMedia,
	AttachmentTitle,
} from "@mercury/ui/components/attachment";
import { Button } from "@mercury/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@mercury/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
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
import {
	CheckCircle2Icon,
	ClipboardPasteIcon,
	FileImageIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	SparklesIcon,
	Trash2Icon,
	XCircleIcon,
} from "lucide-react";
import Image from "next/image";
import { type ClipboardEvent, useEffect, useRef, useState } from "react";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
]);
const DRAFT_STYLE_OPTIONS = [
	{ label: "按日期轮换", value: "auto" },
	{ label: "朋友聊天", value: "chatty" },
	{ label: "随手碎碎念", value: "notes" },
	{ label: "现场叙事", value: "story" },
	{ label: "克制观察", value: "observational" },
	{ label: "轻吐槽", value: "dry_humor" },
	{ label: "温柔共情", value: "gentle" },
] as const satisfies readonly {
	label: string;
	value: XiaohongshuDraftStyle;
}[];

export interface GeneratedDraft {
	content: string;
	mediaPath: string;
	title: string;
	topics: string[];
}

interface GenerateDraftInput {
	imageDataUrl: string;
	intent?: string;
	style: XiaohongshuDraftStyle;
}

interface ScreenshotDraftGeneratorProps {
	disabled: boolean;
	onGenerate: (input: GenerateDraftInput) => Promise<GeneratedDraft>;
	onGenerated: (draft: GeneratedDraft) => void;
	onMediaInvalidated: () => void;
}

interface SelectedScreenshot {
	file: File;
	previewUrl: string;
}

interface FeedbackState {
	description: string;
	kind: "error" | "success";
	title: string;
}

const formatFileSize = (bytes: number): string => {
	const bytesPerMiB = 1024 * 1024;
	if (bytes >= bytesPerMiB) {
		return `${(bytes / bytesPerMiB).toFixed(1)} MB`;
	}

	return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
};

const getErrorMessage = (error: unknown): string =>
	error instanceof Error && error.message.trim()
		? error.message
		: "AI 文案生成失败，请稍后重试。";

const isDraftStyle = (value: string): value is XiaohongshuDraftStyle =>
	XIAOHONGSHU_DRAFT_STYLE_VALUES.some((style) => style === value);

const readFileAsDataUrl = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("截图读取失败，请重新粘贴。"));
		reader.onload = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
				return;
			}

			reject(new Error("截图读取失败，请重新粘贴。"));
		};
		reader.readAsDataURL(file);
	});

export default function ScreenshotDraftGenerator({
	disabled,
	onGenerate,
	onGenerated,
	onMediaInvalidated,
}: ScreenshotDraftGeneratorProps) {
	const [draftStyle, setDraftStyle] = useState<XiaohongshuDraftStyle>("auto");
	const [feedback, setFeedback] = useState<FeedbackState | null>(null);
	const [intent, setIntent] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);
	const [screenshot, setScreenshot] = useState<SelectedScreenshot | null>(null);
	const pasteTargetRef = useRef<HTMLButtonElement>(null);

	useEffect(
		() => () => {
			if (screenshot) {
				URL.revokeObjectURL(screenshot.previewUrl);
			}
		},
		[screenshot]
	);

	const selectScreenshot = (file: File): void => {
		if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
			setFeedback({
				description: "请粘贴 PNG、JPEG 或 WebP 图片。",
				kind: "error",
				title: "不支持这种文件",
			});
			return;
		}

		if (file.size > MAX_IMAGE_BYTES) {
			setFeedback({
				description: "图片大小不能超过 10 MB。",
				kind: "error",
				title: "截图太大",
			});
			return;
		}

		setScreenshot({ file, previewUrl: URL.createObjectURL(file) });
		setFeedback(null);
		onMediaInvalidated();
	};

	const handlePaste = (event: ClipboardEvent<HTMLButtonElement>): void => {
		if (disabled || isGenerating) {
			return;
		}

		const clipboardItem = Array.from(event.clipboardData.items).find(
			(item) => item.kind === "file"
		);
		const file = clipboardItem?.getAsFile();
		if (!file) {
			setFeedback({
				description: "剪贴板中没有可用的图片。",
				kind: "error",
				title: "没有检测到截图",
			});
			return;
		}

		event.preventDefault();
		selectScreenshot(file);
	};

	const handleRemove = (): void => {
		setScreenshot(null);
		setFeedback(null);
		onMediaInvalidated();
		pasteTargetRef.current?.focus();
	};

	const handleDraftStyleChange = (value: string | null): void => {
		if (value && isDraftStyle(value)) {
			setDraftStyle(value);
		}
	};

	const handleGenerate = async (): Promise<void> => {
		if (!screenshot || disabled || isGenerating) {
			return;
		}

		setFeedback(null);
		setIsGenerating(true);
		try {
			const imageDataUrl = await readFileAsDataUrl(screenshot.file);
			const normalizedIntent = intent.trim();
			const draft = await onGenerate({
				imageDataUrl,
				...(normalizedIntent ? { intent: normalizedIntent } : {}),
				style: draftStyle,
			});
			onGenerated(draft);
			setFeedback({
				description: "标题、正文和话题已填入下方，请确认后发布。",
				kind: "success",
				title: "文案已生成",
			});
		} catch (error) {
			setFeedback({
				description: getErrorMessage(error),
				kind: "error",
				title: "生成失败",
			});
		} finally {
			setIsGenerating(false);
		}
	};

	const isBusy = disabled || isGenerating;
	const selectedStyleLabel =
		DRAFT_STYLE_OPTIONS.find((option) => option.value === draftStyle)?.label ??
		"按日期轮换";

	return (
		<section aria-label="AI 文案生成" className="h-full">
			<div className="flex h-full flex-col gap-4">
				{screenshot ? (
					<div className="flex flex-col gap-3">
						<Button
							aria-label="粘贴截图以更换当前截图"
							className="relative h-[clamp(210px,30svh,300px)] w-full overflow-hidden p-0"
							disabled={isBusy}
							onPaste={handlePaste}
							ref={pasteTargetRef}
							type="button"
							variant="dropzone"
						>
							<Image
								alt={`${screenshot.file.name} 预览`}
								className="object-contain"
								fill
								sizes="(max-width: 1024px) 100vw, 700px"
								src={screenshot.previewUrl}
								unoptimized
							/>
						</Button>

						<Attachment
							className="w-full"
							state={isGenerating ? "processing" : "done"}
						>
							<AttachmentMedia>
								<FileImageIcon aria-hidden="true" />
							</AttachmentMedia>
							<AttachmentContent>
								<AttachmentTitle>{screenshot.file.name}</AttachmentTitle>
								<AttachmentDescription>
									{formatFileSize(screenshot.file.size)} ·{" "}
									{screenshot.file.type}
								</AttachmentDescription>
							</AttachmentContent>
							<AttachmentActions>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger
											render={
												<AttachmentAction
													aria-label="更换截图"
													disabled={isBusy}
													onClick={() => pasteTargetRef.current?.focus()}
												>
													<RefreshCwIcon aria-hidden="true" />
												</AttachmentAction>
											}
										/>
										<TooltipContent>更换截图</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger
											render={
												<AttachmentAction
													aria-label="删除截图"
													disabled={isBusy}
													onClick={handleRemove}
												>
													<Trash2Icon aria-hidden="true" />
												</AttachmentAction>
											}
										/>
										<TooltipContent>删除截图</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							</AttachmentActions>
						</Attachment>
					</div>
				) : (
					<Button
						aria-label="粘贴截图"
						className="h-[clamp(210px,30svh,300px)] w-full flex-col gap-3 whitespace-normal px-6 py-8 text-center"
						disabled={isBusy}
						onPaste={handlePaste}
						ref={pasteTargetRef}
						type="button"
						variant="dropzone"
					>
						<span data-slot="dropzone-icon">
							<ClipboardPasteIcon aria-hidden="true" />
						</span>
						<span data-slot="dropzone-title">在这里粘贴截图</span>
						<span data-slot="dropzone-hint">
							支持 PNG、JPEG 或 WebP，最大 10&nbsp;MB
						</span>
					</Button>
				)}

				<FieldGroup>
					<div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
						<Field>
							<FieldLabel htmlFor="xhs-ai-style">文案风格</FieldLabel>
							<Select
								disabled={isBusy}
								name="draftStyle"
								onValueChange={handleDraftStyleChange}
								value={draftStyle}
							>
								<SelectTrigger className="w-full" id="xhs-ai-style">
									<SelectValue>{selectedStyleLabel}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{DRAFT_STYLE_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="xhs-ai-intent">补充意图（可选）</FieldLabel>
							<InputGroup>
								<InputGroupTextarea
									autoComplete="off"
									className="min-h-24"
									disabled={isBusy}
									id="xhs-ai-intent"
									maxLength={500}
									name="intent"
									onChange={(event) => setIntent(event.target.value)}
									placeholder="例如：轻松吐槽这次服务器故障…"
									value={intent}
								/>
								<InputGroupAddon
									align="block-end"
									className="justify-end tabular-nums"
								>
									{intent.length}/500
								</InputGroupAddon>
							</InputGroup>
						</Field>
					</div>
				</FieldGroup>

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

				<div className="mt-auto flex justify-end pt-2">
					<Button
						disabled={isBusy || !screenshot}
						onClick={handleGenerate}
						type="button"
					>
						{isGenerating ? (
							<LoaderCircleIcon
								aria-hidden="true"
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : (
							<SparklesIcon aria-hidden="true" data-icon="inline-start" />
						)}
						{isGenerating ? "生成中…" : "生成文案"}
					</Button>
				</div>
			</div>
		</section>
	);
}
