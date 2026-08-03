import { db, GeocodeCacheStatus } from "@crm/db";
import { NominatimGeocoder } from "../src/geocode/nominatim.geocoder";
import { buildPlaceKey } from "../src/geocode/place-key";

/**
 * Geocode companies that have a city but no coordinates.
 *
 * Groups by place key so ~14k rows only hit Nominatim once per unique
 * city/state/country. Successful and failed lookups are cached forever.
 *
 *   bun run scripts/geocode-companies.ts
 *   bun run scripts/geocode-companies.ts --limit=50
 *   bun run scripts/geocode-companies.ts --dry-run
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;

const companies = await db.company.findMany({
	where: {
		city: { not: null },
		OR: [{ latitude: null }, { longitude: null }],
	},
	select: {
		id: true,
		name: true,
		city: true,
		stateCode: true,
		country: true,
		countryCode: true,
	},
	orderBy: { name: "asc" },
});

type PlaceBucket = {
	placeKey: string;
	city: string | null;
	stateCode: string | null;
	country: string | null;
	countryCode: string | null;
	companyIds: string[];
};

const buckets = new Map<string, PlaceBucket>();
let skippedNoKey = 0;

for (const company of companies) {
	const placeKey = buildPlaceKey(
		company.city,
		company.stateCode,
		company.countryCode ?? company.country,
	);
	if (!placeKey) {
		skippedNoKey += 1;
		continue;
	}
	const existing = buckets.get(placeKey);
	if (existing) {
		existing.companyIds.push(company.id);
		continue;
	}
	buckets.set(placeKey, {
		placeKey,
		city: company.city,
		stateCode: company.stateCode,
		country: company.country,
		countryCode: company.countryCode,
		companyIds: [company.id],
	});
}

let places = [...buckets.values()];
if (limit != null && Number.isFinite(limit) && limit > 0) {
	places = places.slice(0, limit);
}

console.log(
	`Companies needing coords: ${companies.length}; unique places: ${buckets.size}; will process: ${places.length}${dryRun ? " (dry-run)" : ""}`,
);
if (skippedNoKey > 0) {
	console.log(`Skipped (no usable city): ${skippedNoKey}`);
}

const geocoder = new NominatimGeocoder();
let cacheHits = 0;
let fetchedOk = 0;
let fetchedFail = 0;
let companiesUpdated = 0;

for (const place of places) {
	const cached = await db.geocodeCache.findUnique({
		where: { placeKey: place.placeKey },
	});

	let latitude: number | null = null;
	let longitude: number | null = null;
	let status: GeocodeCacheStatus = GeocodeCacheStatus.failed;

	if (cached) {
		cacheHits += 1;
		latitude = cached.latitude;
		longitude = cached.longitude;
		status = cached.status;
	} else if (dryRun) {
		console.log(`[dry-run] would geocode ${place.placeKey} (${place.companyIds.length} companies)`);
		continue;
	} else {
		const result = await geocoder.geocode({
			city: place.city,
			stateCode: place.stateCode,
			country: place.country,
			countryCode: place.countryCode,
		});

		if (result.ok) {
			latitude = result.latitude;
			longitude = result.longitude;
			status = GeocodeCacheStatus.ok;
			fetchedOk += 1;
			await db.geocodeCache.create({
				data: {
					placeKey: place.placeKey,
					latitude,
					longitude,
					status,
					rawLabel: result.rawLabel,
				},
			});
			console.log(
				`ok  ${place.placeKey} → ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (${place.companyIds.length})`,
			);
		} else {
			fetchedFail += 1;
			status =
				result.reason === "empty"
					? GeocodeCacheStatus.skipped
					: GeocodeCacheStatus.failed;
			await db.geocodeCache.create({
				data: {
					placeKey: place.placeKey,
					latitude: null,
					longitude: null,
					status,
					rawLabel: result.detail ?? result.reason,
				},
			});
			console.log(
				`fail ${place.placeKey} (${result.reason}${result.detail ? `: ${result.detail}` : ""})`,
			);
		}
	}

	if (dryRun) continue;

	if (status === GeocodeCacheStatus.ok && latitude != null && longitude != null) {
		const now = new Date();
		const result = await db.company.updateMany({
			where: { id: { in: place.companyIds } },
			data: {
				latitude,
				longitude,
				geocodePlaceKey: place.placeKey,
				geocodedAt: now,
			},
		});
		companiesUpdated += result.count;
	} else {
		// Mark the place key so we do not keep retrying empties every run without
		// a cache row already covering it — companies stay without coords.
		await db.company.updateMany({
			where: { id: { in: place.companyIds }, geocodePlaceKey: null },
			data: { geocodePlaceKey: place.placeKey },
		});
	}
}

console.log(
	`\nDone. cacheHits=${cacheHits} fetchedOk=${fetchedOk} fetchedFail=${fetchedFail} companiesUpdated=${companiesUpdated}`,
);
await db.$disconnect();
