import "@crm/env/load";
import { db, GeocodeCacheStatus } from "@crm/db";
import { NominatimGeocoder } from "../src/geocode/nominatim.geocoder";
import {
	mapPool,
	PhotonGeocoder,
	type GeocodeParts,
	type GeocodeResult,
} from "../src/geocode/photon.geocoder";
import { buildPlaceKey } from "../src/geocode/place-key";

/**
 * Geocode companies that have a city but no coordinates.
 *
 * Groups by place key so ~14k rows only hit the geocoder once per unique
 * city/state/country. Successful and failed lookups are cached forever.
 *
 * Default provider is Photon (Komoot / OSM) with concurrency — much faster
 * than Nominatim's 1 req/s. Use `--provider=nominatim` for the strict path.
 *
 *   bun run scripts/geocode-companies.ts --refresh-stale --dry-run
 *   bun run scripts/geocode-companies.ts --refresh-stale
 *   bun run scripts/geocode-companies.ts --limit=50
 *   bun run scripts/geocode-companies.ts --provider=nominatim
 *   bun run scripts/geocode-companies.ts --concurrency=8
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const refreshStale = args.includes("--refresh-stale");
const noFallback = args.includes("--no-fallback");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="));
const concurrency = concurrencyArg
	? Number(concurrencyArg.slice("--concurrency=".length))
	: 8;
const providerArg = args.find((arg) => arg.startsWith("--provider="));
const provider = (providerArg?.slice("--provider=".length) ?? "photon") as
	| "photon"
	| "nominatim";

if (refreshStale) {
	const all = await db.company.findMany({
		where: { city: { not: null } },
		select: {
			id: true,
			city: true,
			stateCode: true,
			country: true,
			countryCode: true,
			geocodePlaceKey: true,
			latitude: true,
			longitude: true,
		},
	});
	const staleIds: string[] = [];
	for (const row of all) {
		const expected = buildPlaceKey(
			row.city,
			row.stateCode,
			row.countryCode ?? row.country,
		);
		if (!expected) continue;
		const stale =
			row.latitude == null ||
			row.longitude == null ||
			row.geocodePlaceKey !== expected;
		if (stale) staleIds.push(row.id);
	}
	console.log(
		`Stale / missing coords: ${staleIds.length} of ${all.length} companies with a city`,
	);
	if (!dryRun && staleIds.length > 0) {
		const CHUNK = 500;
		for (let i = 0; i < staleIds.length; i += CHUNK) {
			const batch = staleIds.slice(i, i + CHUNK);
			await db.company.updateMany({
				where: { id: { in: batch } },
				data: {
					latitude: null,
					longitude: null,
					geocodePlaceKey: null,
					geocodedAt: null,
				},
			});
		}
		console.log(`Cleared coords on ${staleIds.length} companies.`);
	} else if (dryRun) {
		console.log("Dry run — would clear those coords before geocoding.");
	}
}

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

const effectiveConcurrency = provider === "nominatim" ? 1 : Math.max(1, concurrency);

console.log(
	`Companies needing coords: ${companies.length}; unique places: ${buckets.size}; will process: ${places.length}; provider=${provider}; concurrency=${effectiveConcurrency}${dryRun ? " (dry-run)" : ""}`,
);
if (skippedNoKey > 0) {
	console.log(`Skipped (no usable city): ${skippedNoKey}`);
}

const photon = new PhotonGeocoder();
const nominatim = new NominatimGeocoder();

async function resolvePlace(parts: GeocodeParts): Promise<GeocodeResult> {
	if (provider === "nominatim") {
		return nominatim.geocode(parts);
	}
	const primary = await photon.geocode(parts);
	if (primary.ok || noFallback) return primary;
	return nominatim.geocode(parts);
}

let cacheHits = 0;
let fetchedOk = 0;
let fetchedFail = 0;
let companiesUpdated = 0;
let progressed = 0;

await mapPool(places, effectiveConcurrency, async (place) => {
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
		console.log(
			`[dry-run] would geocode ${place.placeKey} (${place.companyIds.length} companies)`,
		);
		return;
	} else {
		const result = await resolvePlace({
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
		}
	}

	if (dryRun) return;

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
		await db.company.updateMany({
			where: { id: { in: place.companyIds }, geocodePlaceKey: null },
			data: { geocodePlaceKey: place.placeKey },
		});
	}

	progressed += 1;
	if (progressed % 200 === 0 || progressed === places.length) {
		console.log(
			`  progress ${progressed}/${places.length} (ok=${fetchedOk} fail=${fetchedFail} cache=${cacheHits})`,
		);
	}
});

console.log(
	`\nDone. cacheHits=${cacheHits} fetchedOk=${fetchedOk} fetchedFail=${fetchedFail} companiesUpdated=${companiesUpdated}`,
);
await db.$disconnect();
