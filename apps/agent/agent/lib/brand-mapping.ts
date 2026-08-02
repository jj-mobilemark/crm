import type { Prisma } from "@crm/db";
import type { Brand } from "./context-dev";

/**
 * What the agent is allowed to change about a company.
 *
 * Every field Context.dev returns is nullable, and a human's typed-in value
 * always outranks a guess: this only ever *fills gaps*, which is why almost
 * every assignment goes through `fill`.
 *
 * The two exceptions are `name` and `iconUrl`, and both are exceptions for the
 * same reason — their existing value was written by us rather than by a person,
 * so there is nobody to overrule. Each is marked at the assignment.
 */
export type BrandUpdate = Prisma.CompanyUpdateInput;

/** The current values, so we know which gaps there are to fill. */
export type CompanySnapshot = {
	name: string;
	/** True when the record was created domain-first and never named by a human. */
	nameIsPlaceholder: boolean;
	description: string | null;
	logoUrl: string | null;
	logoDarkUrl: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	brandColor: string | null;
	industry: string | null;
	subIndustry: string | null;
	city: string | null;
	stateCode: string | null;
	country: string | null;
	countryCode: string | null;
	phone: string | null;
	email: string | null;
	linkedinUrl: string | null;
	twitterUrl: string | null;
	githubUrl: string | null;
	pricingUrl: string | null;
	careersUrl: string | null;
};

/**
 * Picks a logo by `mode` and `type` rather than taking `logos[0]`.
 *
 * The array is not ordered by usefulness: taking the first one is how you end
 * up with a dark-mode wordmark on a white table row.
 */
type LogoMode = "light" | "dark" | "has_opaque_background";

function pickEntry(
	logos: Brand["logos"],
	type: "logo" | "icon",
	mode?: LogoMode,
) {
	return (logos ?? []).find(
		(logo) =>
			logo?.url &&
			logo.type === type &&
			(mode === undefined || logo.mode === mode),
	);
}

function pickLogo(
	logos: Brand["logos"],
	type: "logo" | "icon",
	mode?: LogoMode,
): string | null {
	return pickEntry(logos, type, mode)?.url ?? null;
}

/**
 * The icon to render, preferring one that carries its own background.
 *
 * `has_opaque_background` is Context.dev saying the artwork is already composed
 * on a tile, which is the only kind that needs no help from us in either theme.
 */
function pickIcon(logos: Brand["logos"]) {
	return (
		pickEntry(logos, "icon", "has_opaque_background") ??
		pickEntry(logos, "icon", "light") ??
		pickEntry(logos, "icon")
	);
}

/**
 * How the chosen icon behaves against a background.
 *
 * Most brands publish a light-mode logo and nothing else — of the companies
 * enriched so far, every one had colour data and only two had a dark icon — so
 * the artwork's own dominant colour, not a second URL, is what makes a black
 * wordmark visible in dark mode.
 */
function iconTone(logos: Brand["logos"]): string | null {
	const icon = pickIcon(logos);
	if (!icon) return null;

	if (icon.mode === "has_opaque_background") return "opaque";

	const rgb = parseHex(icon.colors?.find((colour) => colour?.hex)?.hex);
	if (!rgb) return null;

	// Only near-greyscale artwork is a candidate. The fix downstream is a CSS
	// invert, and inverting a coloured mark does not make it visible — it makes
	// it the wrong brand: Monzo's coral comes out teal. A saturated logo is left
	// alone even if it is dark, because a wrong-coloured logo is worse than a
	// dim one.
	const [r, g, b] = rgb;
	const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
	if (saturation > 0.12) return null;

	// Rec. 601 weighting — enough to answer "is this light or dark", and cheaper
	// than the sRGB-linearised version nobody would notice here.
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

	// Deliberately not a split at the midpoint. Only artwork close to pure black
	// or pure white actually disappears against a theme background, and only
	// that artwork survives an invert unchanged. Everything in between keeps its
	// own colours.
	if (luminance < 0.2) return "dark";
	if (luminance > 0.8) return "light";
	return null;
}

/** `#rrggbb` to a channel triple. */
function parseHex(
	hex: string | null | undefined,
): [number, number, number] | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
	if (!match?.[1]) return null;

	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function social(socials: Brand["socials"], type: string): string | null {
	return (socials ?? []).find((entry) => entry?.type === type)?.url ?? null;
}

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/**
 * Builds the Prisma update for a brand lookup.
 *
 * Returns the fields the lookup actually found that are currently empty — plus
 * the two the agent owns outright — so re-enriching a company a rep has been
 * editing does not undo their work.
 */
export function brandToUpdate(
	brand: Brand,
	current: CompanySnapshot,
): BrandUpdate {
	const update: BrandUpdate = {};

	const fill = <K extends keyof CompanySnapshot & keyof BrandUpdate>(
		key: K,
		value: string | null,
	) => {
		if (value && current[key as keyof CompanySnapshot] === null) {
			(update as Record<string, unknown>)[key] = value;
		}
	};

	// The one non-null field the agent may replace: a company created from a
	// domain alone is named after the domain until we know better.
	const title = clean(brand.title);
	if (title && current.nameIsPlaceholder) {
		update.name = title;
	}

	fill("description", clean(brand.description) ?? clean(brand.slogan));

	fill("logoUrl", pickLogo(brand.logos, "logo", "light"));
	fill("logoDarkUrl", pickLogo(brand.logos, "logo", "dark"));

	// The second non-null field the agent may replace, and for the same reason
	// as the name: `iconUrl` has another writer. The API derives a favicon from
	// the domain so a new company is not a grey square while we work, and this
	// icon is the curated one — `fill` would see a non-null value and skip,
	// leaving the stand-in in place permanently. No human can set `iconUrl`
	// (it is not in `companyUpdateInput`), so there is nobody to overrule.
	const icon = pickIcon(brand.logos)?.url ?? null;
	if (icon) update.iconUrl = icon;

	fill("iconDarkUrl", pickLogo(brand.logos, "icon", "dark"));
	fill("iconTone", iconTone(brand.logos));

	// `colors[].name` is generated rather than the brand's own name for it, so
	// the hex is the only part worth storing.
	fill("brandColor", clean(brand.colors?.[0]?.hex));

	const eic = brand.industries?.eic?.[0];
	fill("industry", clean(eic?.industry));
	fill("subIndustry", clean(eic?.subindustry));

	fill("city", clean(brand.address?.city));
	fill("stateCode", clean(brand.address?.state_code));
	fill("country", clean(brand.address?.country));
	fill("countryCode", clean(brand.address?.country_code));

	fill("phone", clean(brand.phone));
	fill("email", clean(brand.email));

	fill("linkedinUrl", social(brand.socials, "linkedin"));
	fill(
		"twitterUrl",
		social(brand.socials, "x") ?? social(brand.socials, "twitter"),
	);
	fill("githubUrl", social(brand.socials, "github"));

	fill("pricingUrl", clean(brand.links?.pricing));
	fill("careersUrl", clean(brand.links?.careers));

	return update;
}

/** Fields worth counting when logging what a lookup actually achieved. */
export function filledFields(update: BrandUpdate): string[] {
	return Object.keys(update);
}
