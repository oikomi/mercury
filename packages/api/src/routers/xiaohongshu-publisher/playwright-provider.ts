import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import { type BrowserContext, chromium, type Page } from "playwright";

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

const CREATOR_URL = "https://creator.xiaohongshu.com/";
const PUBLIC_SITE_URL = "https://www.xiaohongshu.com/";
const LOGIN_TIMEOUT_MS = 180_000;
const PAGE_TIMEOUT_MS = 30_000;
const RESULT_TIMEOUT_MS = 15_000;
const SAFE_FILE_NAME_PATTERN = /[^a-zA-Z0-9_-]/gu;
const TRAILING_SLASH_PATTERN = /\/$/u;
const PUBLIC_NOTE_PATH_PATTERN = /^\/explore\/[a-zA-Z0-9_-]+\/?$/u;
const PUBLIC_NOTE_URL_PATTERN =
	/^https:\/\/(?:www\.)?xiaohongshu\.com\/explore\/[a-zA-Z0-9_-]+/u;
const LOGIN_TEXT_PATTERN = /扫码登录|手机号登录|登录后即可|请登录/u;
const READY_TEXT_PATTERN = /发布笔记|发布管理|数据看板|创作中心/u;
const SUCCESS_TEXT_PATTERN = /发布成功|笔记发布成功|提交成功/u;
const VISIBILITY_TRIGGER_PATTERN = /公开可见|公开|可见范围/u;
const TITLE_PLACEHOLDER_PATTERN = /填写标题|标题/u;
const PUBLISH_BUTTON_TEXT = "发布";
const RESULT_LINK_PATTERN = /查看笔记|查看作品|查看详情/u;

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

const buildDescription = (input: XiaohongshuPublishInput): string => {
	const topicText = input.topics.map((topic) => `#${topic}`).join(" ");
	return [input.content, topicText].filter(Boolean).join("\n\n");
};

export const getCreatorPublishUrl = (mediaType: "image" | "video"): string =>
	`https://creator.xiaohongshu.com/publish/publish?from=homepage&target=${mediaType}`;

const getSessionStatus = async (
	page: Page,
	profilePath: string
): Promise<XiaohongshuSessionStatus> => {
	const loginVisible = await page
		.getByText(LOGIN_TEXT_PATTERN)
		.first()
		.isVisible()
		.catch(() => false);
	if (loginVisible) {
		return {
			displayName: null,
			profilePath,
			status: "login_required",
		};
	}

	const readyVisible = await page
		.getByText(READY_TEXT_PATTERN)
		.first()
		.isVisible()
		.catch(() => false);

	return {
		displayName: null,
		profilePath,
		status: readyVisible ? "ready" : "error",
	};
};

const waitForSessionUi = async (page: Page, timeout: number): Promise<void> => {
	await Promise.any([
		page.getByText(LOGIN_TEXT_PATTERN).first().waitFor({ timeout }),
		page.getByText(READY_TEXT_PATTERN).first().waitFor({ timeout }),
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
		.locator('[contenteditable="true"]')
		.first()
		.fill(description, { timeout: PAGE_TIMEOUT_MS });
};

export const clickPublish = async (page: Page): Promise<void> => {
	await page
		.getByText(PUBLISH_BUTTON_TEXT, { exact: true })
		.last()
		.click({ timeout: PAGE_TIMEOUT_MS });
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
	await uploadMedia(page, input.media);
	await page
		.getByPlaceholder(TITLE_PLACEHOLDER_PATTERN)
		.first()
		.fill(input.title, { timeout: PAGE_TIMEOUT_MS });
	await fillDescription(page, buildDescription(input));
	await applyVisibility(page, input.visibility);
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
			channel: "chrome",
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
			context = await openContext(true);
			const page = context.pages()[0] ?? (await context.newPage());
			await page.goto(CREATOR_URL, {
				timeout: PAGE_TIMEOUT_MS,
				waitUntil: "domcontentloaded",
			});
			await waitForSessionUi(page, PAGE_TIMEOUT_MS);

			return getSessionStatus(page, options.profileDir);
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

				await page
					.getByText(READY_TEXT_PATTERN)
					.first()
					.waitFor({ timeout: LOGIN_TIMEOUT_MS })
					.catch(() => undefined);

				return getSessionStatus(page, options.profileDir);
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
