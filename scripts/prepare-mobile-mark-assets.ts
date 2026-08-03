/**
 * Rebuild Mobile Mark favicons / mark / wordmark under apps/app/public.
 *
 * Requires a one-off: `bun add -d sharp` (not a permanent workspace dep).
 *
 *   bun run scripts/prepare-mobile-mark-assets.ts
 */
import sharp from "sharp";

const iconSrc =
	"/Users/jordanjohnson/.cursor/projects/Users-jordanjohnson-Documents-Github-MM-CRM/assets/mobile-mark-favicon-53d38aee-ec21-476d-8191-6ad119b96d9f.png";
const wordSrc =
	"/Users/jordanjohnson/.cursor/projects/Users-jordanjohnson-Documents-Github-MM-CRM/assets/Official-MobileMark-High-Res-PNG-c4c3c8ec-3ad4e009-e1e4-4fef-bad2-28118b4f14b9.png";
const pub = "apps/app/public";
const ui = "packages/ui/src/assets";

async function whiteToTransparent(input: string) {
	const { data, info } = await sharp(input)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i]!;
		const g = data[i + 1]!;
		const b = data[i + 2]!;
		if (r > 245 && g > 245 && b > 245) data[i + 3] = 0;
	}
	return sharp(data, {
		raw: { width: info.width, height: info.height, channels: 4 },
	});
}

const icon = await whiteToTransparent(iconSrc);
const trimmed = await icon.trim().png().toBuffer();
const padded = await sharp(trimmed)
	.resize(512, 512, {
		fit: "contain",
		background: { r: 0, g: 0, b: 0, alpha: 0 },
	})
	.png()
	.toBuffer();

await sharp(padded).png().toFile(`${ui}/mobile-mark-mark.png`);
await sharp(padded).png().toFile(`${pub}/mobile-mark-mark.png`);
await sharp(padded).resize(96, 96).png().toFile(`${pub}/favicon-96x96.png`);
await sharp(padded).resize(180, 180).png().toFile(`${pub}/apple-touch-icon.png`);
await sharp(padded)
	.resize(192, 192)
	.png()
	.toFile(`${pub}/web-app-manifest-192x192.png`);
await sharp(padded)
	.resize(512, 512)
	.png()
	.toFile(`${pub}/web-app-manifest-512x512.png`);

// Multi-size ICO (32 + 16)
const ico32 = await sharp(padded).resize(32, 32).png().toBuffer();
const ico16 = await sharp(padded).resize(16, 16).png().toBuffer();
await sharp(ico32).toFile(`${pub}/favicon.ico`);
await sharp(ico32).toFile("apps/app/app/favicon.ico");

// SVG-ish: also write a simple PNG-based replacement for favicon.svg consumers
// by writing an SVG that embeds the mark as data URL is heavy — write a blue
// mark SVG approximation instead in a follow-up. For now copy PNG as primary.

await sharp(wordSrc).png().toFile(`${pub}/mobile-mark-wordmark.png`);
await sharp(wordSrc).png().toFile(`${ui}/mobile-mark-wordmark.png`);

console.log("assets written");
