import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import {
	type BrowserContext,
	chromium,
	type Locator,
	type Page,
	type Request,
} from "playwright";

import { XIAOHONGSHU_TITLE_MAX_LENGTH } from "./constants";
import type {
	XiaohongshuPublishInput,
	XiaohongshuPublishProvider,
	XiaohongshuPublishResult,
	XiaohongshuSessionStatus,
} from "./provider";

interface PlaywrightProviderOptions {
	artifactDir: string;
	profileDir: string;
}

interface PublishConfirmationEvidence {
	currentUrl: string;
	linkedResultUrl: string | null;
	successVisible: boolean;
}

interface CdpDomNode {
	attributes?: string[];
	children?: CdpDomNode[];
	nodeId: number;
	nodeName: string;
	nodeType: number;
	nodeValue: string;
	shadowRoots?: CdpDomNode[];
}

const CREATOR_URL = "https://creator.xiaohongshu.com/";
const CREATOR_API_HOST = "creator.xiaohongshu.com";
const PUBLIC_SITE_URL = "https://www.xiaohongshu.com/";
const LOGIN_TIMEOUT_MS = 180_000;
const PAGE_TIMEOUT_MS = 30_000;
const RESULT_TIMEOUT_MS = 15_000;
const SESSION_REDIRECT_GRACE_MS = 5000;
const CREATOR_API_IDLE_MS = 1500;
const CREATOR_API_IDLE_TIMEOUT_MS = 15_000;
const CREATOR_API_IDLE_POLL_MS = 100;
const SAFE_FILE_NAME_PATTERN = /[^a-zA-Z0-9_-]/gu;
const TRAILING_SLASH_PATTERN = /\/$/u;
const LOGIN_PATH_PATTERN = /^\/login(?:\/|$)/u;
const PUBLIC_NOTE_PATH_PATTERN = /^\/explore\/[a-zA-Z0-9_-]+\/?$/u;
const PUBLIC_NOTE_URL_PATTERN =
	/^https:\/\/(?:www\.)?xiaohongshu\.com\/explore\/[a-zA-Z0-9_-]+/u;
const LOGIN_TEXT_PATTERN = /扫码登录|手机号登录|短信登录|登录后即可|请登录/u;
const READY_TEXT_PATTERN = /发布笔记|发布管理|数据看板|创作中心/u;
const SUCCESS_TEXT_PATTERN = /发布成功|笔记发布成功|提交成功/u;
const VISIBILITY_TRIGGER_PATTERN = /公开可见|公开|可见范围/u;
const TITLE_PLACEHOLDER_PATTERN = /填写标题|标题/u;
const RESULT_LINK_PATTERN = /查看笔记|查看作品|查看详情/u;
const ACCOUNT_NAME_SELECTOR = ".user-info .name-box";
const DESCRIPTION_EDITOR_SELECTOR = '[contenteditable="true"]';
const TOPIC_BUTTON_SELECTOR = "#topicBtn";
const TOPIC_SUGGESTION_CONTAINER_SELECTOR = "#creator-editor-topic-container";
const TOPIC_LINK_SELECTOR = "a.tiptap-topic[data-topic]";
const TOPIC_TYPING_DELAY_MS = 80;
const TRACKED_REQUEST_TYPES = new Set(["fetch", "xhr"]);

export const isCreatorLoginUrl = (candidate: string): boolean => {
	try {
		const url = new URL(candidate);
		return (
			url.hostname === CREATOR_API_HOST && LOGIN_PATH_PATTERN.test(url.pathname)
		);
	} catch {
		return false;
	}
};

const normalizePublicNoteUrl = (candidate: string | null): string | null => {
	if (!candidate) {
		return null;
	}

	try {
		const url = new URL(candidate, PUBLIC_SITE_URL);
		const isPublicHost =
			url.hostname === "xiaohongshu.com" ||
			url.hostname === "www.xiaohongshu.com";
		if (!(isPublicHost && PUBLIC_NOTE_PATH_PATTERN.test(url.pathname))) {
			return null;
		}

		return `${url.origin}${url.pathname.replace(TRAILING_SLASH_PATTERN, "")}`;
	} catch {
		return null;
	}
};

export const resolvePublishConfirmation = ({
	currentUrl,
	linkedResultUrl,
	successVisible,
}: PublishConfirmationEvidence): XiaohongshuPublishResult => {
	const resultUrl =
		normalizePublicNoteUrl(linkedResultUrl) ??
		normalizePublicNoteUrl(currentUrl);
	if (resultUrl) {
		return {
			publishedAt: new Date(),
			resultUrl,
			status: "succeeded",
		};
	}

	return {
		errorCode: "submitted_unknown",
		errorMessage: successVisible
			? "页面显示发布成功，但未找到公开笔记链接，请到小红书后台核对。"
			: "已点击发布，但未能自动确认发布结果，请到小红书后台核对。",
		status: "submitted_unknown",
	};
};

export const getCreatorPublishUrl = (mediaType: "image" | "video"): string =>
	`https://creator.xiaohongshu.com/publish/publish?from=homepage&target=${mediaType}`;

const getReadySessionStatus = async (
	page: Page,
	profilePath: string
): Promise<XiaohongshuSessionStatus | null> => {
	const accountNameLocator = page.locator(ACCOUNT_NAME_SELECTOR).first();
	const accountNameVisible = await accountNameLocator
		.isVisible()
		.catch(() => false);
	if (accountNameVisible) {
		const accountName = await accountNameLocator
			.textContent()
			.catch(() => null);

		return {
			displayName: accountName?.trim() || null,
			profilePath,
			status: "ready",
		};
	}

	const readyVisible = await page
		.getByText(READY_TEXT_PATTERN)
		.first()
		.isVisible()
		.catch(() => false);
	if (!readyVisible) {
		return null;
	}

	return {
		displayName: null,
		profilePath,
		status: "ready",
	};
};

const waitForReadySessionUi = async (
	page: Page,
	timeout: number
): Promise<void> => {
	await Promise.any([
		page
			.locator(ACCOUNT_NAME_SELECTOR)
			.first()
			.waitFor({ state: "visible", timeout }),
		page.getByText(READY_TEXT_PATTERN).first().waitFor({ timeout }),
	]);
};

export const getSessionStatus = async (
	page: Page,
	profilePath: string
): Promise<XiaohongshuSessionStatus> => {
	const readySession = await getReadySessionStatus(page, profilePath);
	if (readySession) {
		return readySession;
	}

	const loginVisible = await page
		.getByText(LOGIN_TEXT_PATTERN)
		.first()
		.isVisible()
		.catch(() => false);
	if (isCreatorLoginUrl(page.url()) || loginVisible) {
		await page.waitForTimeout(SESSION_REDIRECT_GRACE_MS);
		const redirectedSession = await getReadySessionStatus(page, profilePath);
		if (redirectedSession) {
			return redirectedSession;
		}

		return {
			displayName: null,
			profilePath,
			status: "login_required",
		};
	}

	return {
		displayName: null,
		profilePath,
		status: "error",
	};
};

const waitForSessionUi = async (page: Page, timeout: number): Promise<void> => {
	await Promise.any([
		waitForReadySessionUi(page, timeout),
		page.getByText(LOGIN_TEXT_PATTERN).first().waitFor({ timeout }),
	]).catch(() => undefined);
};

const validateMedia = async (input: XiaohongshuPublishInput): Promise<void> => {
	const mediaTypes = new Set(input.media.map((media) => media.type));
	if (mediaTypes.size !== 1) {
		throw new Error("A publish task cannot mix image and video media.");
	}

	await Promise.all(input.media.map((media) => access(media.path)));
};

export const uploadMedia = async (
	page: Page,
	media: XiaohongshuPublishInput["media"]
): Promise<void> => {
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles(media.map((item) => item.path));
};

export const fillDescription = async (
	page: Page,
	description: string
): Promise<void> => {
	await page
		.locator(DESCRIPTION_EDITOR_SELECTOR)
		.first()
		.fill(description, { timeout: PAGE_TIMEOUT_MS });
};

const insertLinkedTopic = async (
	page: Page,
	editor: Locator,
	topic: string
): Promise<void> => {
	const linkedTopicCount = await editor.locator(TOPIC_LINK_SELECTOR).count();
	await page.locator(TOPIC_BUTTON_SELECTOR).click({ timeout: PAGE_TIMEOUT_MS });
	await editor.pressSequentially(topic, { delay: TOPIC_TYPING_DELAY_MS });

	const exactSuggestion = page
		.locator(TOPIC_SUGGESTION_CONTAINER_SELECTOR)
		.getByText(`#${topic}`, { exact: true })
		.first();
	try {
		await exactSuggestion.waitFor({
			state: "visible",
			timeout: PAGE_TIMEOUT_MS,
		});
	} catch (error) {
		throw new Error(
			`小红书没有找到完全匹配的话题“${topic}”，请更换话题后重试。`,
			{ cause: error }
		);
	}

	await exactSuggestion.click({ timeout: PAGE_TIMEOUT_MS });
	await editor
		.locator(TOPIC_LINK_SELECTOR)
		.nth(linkedTopicCount)
		.waitFor({ state: "attached", timeout: PAGE_TIMEOUT_MS });
};

export const fillTopics = async (
	page: Page,
	topics: readonly string[]
): Promise<void> => {
	if (topics.length === 0) {
		return;
	}

	const editor = page.locator(DESCRIPTION_EDITOR_SELECTOR).first();
	await editor.press("Enter");
	await editor.press("Enter");

	for (const topic of topics) {
		// biome-ignore lint/performance/noAwaitInLoops: each selection mutates the same editor state.
		await insertLinkedTopic(page, editor, topic);
	}
};

export const fillTitle = async (page: Page, title: string): Promise<void> => {
	const normalizedTitle = title.trim();
	if (normalizedTitle.length > XIAOHONGSHU_TITLE_MAX_LENGTH) {
		throw new Error(
			`小红书标题最多 ${XIAOHONGSHU_TITLE_MAX_LENGTH} 个字符，当前为 ${normalizedTitle.length} 个字符。`
		);
	}

	await page
		.getByPlaceholder(TITLE_PLACEHOLDER_PATTERN)
		.first()
		.fill(normalizedTitle, { timeout: PAGE_TIMEOUT_MS });
};

const getCdpNodeChildren = (node: CdpDomNode): CdpDomNode[] => [
	...(node.children ?? []),
	...(node.shadowRoots ?? []),
];

const findCdpNode = (
	node: CdpDomNode,
	predicate: (candidate: CdpDomNode) => boolean
): CdpDomNode | undefined => {
	if (predicate(node)) {
		return node;
	}

	for (const child of getCdpNodeChildren(node)) {
		const match = findCdpNode(child, predicate);
		if (match) {
			return match;
		}
	}
};

const getCdpAttribute = (node: CdpDomNode, name: string): string | null => {
	const attributes = node.attributes ?? [];
	const nameIndex = attributes.indexOf(name);
	return nameIndex === -1 ? null : (attributes[nameIndex + 1] ?? null);
};

const containsExactText = (node: CdpDomNode, text: string): boolean => {
	if (node.nodeName === "#text" && node.nodeValue.trim() === text) {
		return true;
	}

	return getCdpNodeChildren(node).some((child) =>
		containsExactText(child, text)
	);
};

const findPublishButtonNodeId = (root: CdpDomNode): number => {
	const host = findCdpNode(
		root,
		({ nodeName }) => nodeName === "XHS-PUBLISH-BTN"
	);
	if (!host) {
		throw new Error("Could not find the Xiaohongshu publish control.");
	}

	const submitText = getCdpAttribute(host, "submit-text") ?? "发布";
	const button = findCdpNode(
		host,
		(candidate) =>
			candidate.nodeName === "BUTTON" &&
			containsExactText(candidate, submitText)
	);
	if (!button) {
		throw new Error("Could not find the publish button in its shadow root.");
	}

	return button.nodeId;
};

const getQuadCenter = (quad: number[]): { x: number; y: number } => {
	const [x1 = Number.NaN, y1 = Number.NaN, x2 = Number.NaN, y2 = Number.NaN] =
		quad;
	const [x3 = Number.NaN, y3 = Number.NaN, x4 = Number.NaN, y4 = Number.NaN] =
		quad.slice(4);
	const coordinates = [x1, y1, x2, y2, x3, y3, x4, y4];
	if (!coordinates.every(Number.isFinite)) {
		throw new Error("The Xiaohongshu publish button has no clickable box.");
	}

	return {
		x: (x1 + x2 + x3 + x4) / 4,
		y: (y1 + y2 + y3 + y4) / 4,
	};
};

export const clickPublish = async (page: Page): Promise<void> => {
	const session = await page.context().newCDPSession(page);
	try {
		await session.send("DOM.enable");
		const { root } = await session.send("DOM.getDocument", {
			depth: -1,
			pierce: true,
		});
		const nodeId = findPublishButtonNodeId(root);
		const { model } = await session.send("DOM.getBoxModel", { nodeId });
		const { x, y } = getQuadCenter(model.border);
		await page.mouse.click(x, y);
	} finally {
		await session.detach().catch(() => undefined);
	}
};

const isCreatorApiRequest = (request: Request): boolean => {
	if (!TRACKED_REQUEST_TYPES.has(request.resourceType())) {
		return false;
	}

	try {
		return new URL(request.url()).hostname === CREATOR_API_HOST;
	} catch {
		return false;
	}
};

export const runAndWaitForCreatorApiIdle = async (
	page: Page,
	operation: () => Promise<void>
): Promise<void> => {
	const pendingRequests = new Set<Request>();
	let lastActivityAt = Date.now();
	const handleRequest = (request: Request): void => {
		if (isCreatorApiRequest(request)) {
			pendingRequests.add(request);
			lastActivityAt = Date.now();
		}
	};
	const handleRequestFinished = (request: Request): void => {
		if (pendingRequests.delete(request)) {
			lastActivityAt = Date.now();
		}
	};

	page.on("request", handleRequest);
	page.on("requestfailed", handleRequestFinished);
	page.on("requestfinished", handleRequestFinished);
	try {
		await operation();
		await new Promise<void>((resolve, reject) => {
			const deadline = Date.now() + CREATOR_API_IDLE_TIMEOUT_MS;
			const checkIdle = (): void => {
				const currentTime = Date.now();
				const idleDuration = currentTime - lastActivityAt;
				if (pendingRequests.size === 0 && idleDuration >= CREATOR_API_IDLE_MS) {
					resolve();
					return;
				}

				if (currentTime >= deadline) {
					reject(
						new Error(
							`Xiaohongshu form did not become idle (${pendingRequests.size} requests pending).`
						)
					);
					return;
				}

				setTimeout(
					checkIdle,
					Math.min(CREATOR_API_IDLE_POLL_MS, deadline - currentTime)
				);
			};

			checkIdle();
		});
	} finally {
		page.off("request", handleRequest);
		page.off("requestfailed", handleRequestFinished);
		page.off("requestfinished", handleRequestFinished);
	}
};

const applyVisibility = async (
	page: Page,
	visibility: XiaohongshuPublishInput["visibility"]
): Promise<void> => {
	if (visibility === "public") {
		return;
	}

	const optionText = visibility === "private" ? "仅自己可见" : "仅粉丝可见";
	await page
		.getByText(VISIBILITY_TRIGGER_PATTERN)
		.first()
		.click({ timeout: PAGE_TIMEOUT_MS });
	await page
		.getByText(optionText, { exact: true })
		.last()
		.click({ timeout: PAGE_TIMEOUT_MS });
};

const fillAndSubmitPublishForm = async (
	page: Page,
	input: XiaohongshuPublishInput
): Promise<void> => {
	await runAndWaitForCreatorApiIdle(page, async () => {
		await uploadMedia(page, input.media);
		await fillTitle(page, input.title);
		await fillDescription(page, input.content);
		await fillTopics(page, input.topics);
		await applyVisibility(page, input.visibility);
		await page
			.locator('xhs-publish-btn[submit-disabled="false"]')
			.waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS });
	});
	await clickPublish(page);
};

const collectPublishConfirmation = async (
	page: Page
): Promise<XiaohongshuPublishResult> => {
	const successMessage = page.getByText(SUCCESS_TEXT_PATTERN).first();
	const resultLink = page
		.getByRole("link", { name: RESULT_LINK_PATTERN })
		.first();
	await Promise.any([
		page.waitForURL(PUBLIC_NOTE_URL_PATTERN, { timeout: RESULT_TIMEOUT_MS }),
		resultLink.waitFor({ timeout: RESULT_TIMEOUT_MS }),
		successMessage.waitFor({ timeout: RESULT_TIMEOUT_MS }),
	]).catch(() => undefined);

	const successVisible = await successMessage.isVisible().catch(() => false);
	const linkedResultUrl = await resultLink
		.getAttribute("href")
		.catch(() => null);

	return resolvePublishConfirmation({
		currentUrl: page.url(),
		linkedResultUrl,
		successVisible,
	});
};

export function createPlaywrightXiaohongshuPublishProvider(
	options: PlaywrightProviderOptions
): XiaohongshuPublishProvider {
	const openContext = async (headless: boolean): Promise<BrowserContext> => {
		await mkdir(options.artifactDir, { recursive: true });
		await mkdir(options.profileDir, { recursive: true });

		return chromium.launchPersistentContext(options.profileDir, {
			args: ["--deny-permission-prompts"],
			channel: "chrome",
			chromiumSandbox: true,
			headless,
			viewport: { height: 900, width: 1440 },
		});
	};

	const screenshot = async (page: Page, taskId: string): Promise<string> => {
		const safeTaskId = taskId.replace(SAFE_FILE_NAME_PATTERN, "_");
		const screenshotPath = path.join(options.artifactDir, `${safeTaskId}.png`);
		await page.screenshot({ fullPage: true, path: screenshotPath });

		return screenshotPath;
	};

	const checkSession = async (): Promise<XiaohongshuSessionStatus> => {
		let context: BrowserContext | undefined;
		try {
			// Xiaohongshu can report a different session for the same profile in headless mode.
			context = await openContext(false);
			const page = context.pages()[0] ?? (await context.newPage());
			await page.goto(CREATOR_URL, {
				timeout: PAGE_TIMEOUT_MS,
				waitUntil: "domcontentloaded",
			});
			await waitForSessionUi(page, PAGE_TIMEOUT_MS);

			return await getSessionStatus(page, options.profileDir);
		} catch {
			return {
				displayName: null,
				profilePath: options.profileDir,
				status: "error",
			};
		} finally {
			await context?.close().catch(() => undefined);
		}
	};

	return {
		checkSession,
		async publish(
			input: XiaohongshuPublishInput
		): Promise<XiaohongshuPublishResult> {
			try {
				await validateMedia(input);
			} catch (error) {
				return {
					errorCode: "media_unavailable",
					errorMessage:
						error instanceof Error
							? `无法读取本机媒体：${error.message}`
							: "无法读取本机媒体。",
					status: "failed",
				};
			}

			let context: BrowserContext | undefined;
			let page: Page | undefined;
			try {
				context = await openContext(false);
				page = context.pages()[0] ?? (await context.newPage());
				await page.goto(CREATOR_URL, {
					timeout: PAGE_TIMEOUT_MS,
					waitUntil: "domcontentloaded",
				});
				await waitForSessionUi(page, PAGE_TIMEOUT_MS);
				const session = await getSessionStatus(page, options.profileDir);
				if (session.status !== "ready") {
					return {
						debugScreenshotPath: await screenshot(page, input.taskId),
						errorCode: "login_required",
						errorMessage: "小红书登录已过期，请先打开登录窗口完成登录。",
						status: "failed",
					};
				}

				await page.goto(getCreatorPublishUrl(input.media[0]?.type ?? "image"), {
					timeout: PAGE_TIMEOUT_MS,
					waitUntil: "domcontentloaded",
				});
				await fillAndSubmitPublishForm(page, input);
				const confirmation = await collectPublishConfirmation(page);
				if (confirmation.status === "submitted_unknown") {
					return {
						...confirmation,
						debugScreenshotPath: await screenshot(page, input.taskId),
					};
				}

				return confirmation;
			} catch (error) {
				const debugScreenshotPath = page
					? await screenshot(page, input.taskId).catch(() => undefined)
					: undefined;

				return {
					debugScreenshotPath,
					errorCode: "browser_automation_failed",
					errorMessage:
						error instanceof Error
							? `小红书页面自动化失败：${error.message}`
							: "小红书页面自动化失败。",
					status: "failed",
				};
			} finally {
				await context?.close().catch(() => undefined);
			}
		},
		async startLogin(): Promise<XiaohongshuSessionStatus> {
			let context: BrowserContext | undefined;
			try {
				context = await openContext(false);
				const page = context.pages()[0] ?? (await context.newPage());
				await page.goto(CREATOR_URL, {
					timeout: PAGE_TIMEOUT_MS,
					waitUntil: "domcontentloaded",
				});
				await waitForSessionUi(page, PAGE_TIMEOUT_MS);
				const initialStatus = await getSessionStatus(page, options.profileDir);
				if (initialStatus.status === "ready") {
					return initialStatus;
				}

				if (initialStatus.status !== "login_required") {
					return initialStatus;
				}

				await waitForReadySessionUi(page, LOGIN_TIMEOUT_MS).catch(
					() => undefined
				);

				return await getSessionStatus(page, options.profileDir);
			} catch {
				return {
					displayName: null,
					profilePath: options.profileDir,
					status: "error",
				};
			} finally {
				await context?.close().catch(() => undefined);
			}
		},
	};
}
