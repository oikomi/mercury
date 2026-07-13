export const XIAOHONGSHU_TITLE_MAX_LENGTH = 20;

export const XIAOHONGSHU_DRAFT_STYLE_VALUES = [
	"auto",
	"chatty",
	"notes",
	"story",
	"observational",
	"dry_humor",
	"gentle",
] as const;

export const XIAOHONGSHU_RESOLVED_DRAFT_STYLE_VALUES = [
	"chatty",
	"notes",
	"story",
	"observational",
	"dry_humor",
	"gentle",
] as const;

export type XiaohongshuDraftStyle =
	(typeof XIAOHONGSHU_DRAFT_STYLE_VALUES)[number];

export type XiaohongshuResolvedDraftStyle =
	(typeof XIAOHONGSHU_RESOLVED_DRAFT_STYLE_VALUES)[number];

export const truncateXiaohongshuTitle = (title: string): string => {
	const characters: string[] = [];
	let titleLength = 0;

	for (const character of title.trim()) {
		if (titleLength + character.length > XIAOHONGSHU_TITLE_MAX_LENGTH) {
			break;
		}

		characters.push(character);
		titleLength += character.length;
	}

	return characters.join("");
};
