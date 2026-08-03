/**
 * Import geocode results into the local DB from either a JSON dump or
 * SOURCE_DATABASE_URL (prod via TCP proxy).
 *
 *   SOURCE_DATABASE_URL='postgresql://…' bun run scripts/pull-geocode-from-prod.ts
 *   GEOCODE_DUMP_PATH=/tmp/dump.json bun run scripts/pull-geocode-from-prod.ts
 */
import "@crm/env/load";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { type GeocodeCacheStatus, PrismaClient } from "../src/generated/prisma/client";

type CacheRow = {
	placeKey: string;
	latitude: number | null;
	longitude: number | null;
	status: GeocodeCacheStatus;
	rawLabel: string | null;
	queriedAt: string | Date;
};

type CompanyRow = {
	id: string;
	latitude: number | null;
	longitude: number | null;
	geocodePlaceKey: string | null;
	geocodedAt: string | Date | null;
};

type Dump = { cache: CacheRow[]; companies: CompanyRow[] };

const localUrl = process.env.DATABASE_URL;
if (!localUrl) {
	throw new Error("DATABASE_URL (local) is not set.");
}

function client(url: string) {
	return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

async function loadDump(): Promise<Dump> {
	const path = process.env.GEOCODE_DUMP_PATH;
	if (path) {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Dump;
		console.log(`Loaded dump ${path}`);
		return raw;
	}

	const sourceUrl = process.env.SOURCE_DATABASE_URL;
	if (!sourceUrl) {
		throw new Error(
			"Set GEOCODE_DUMP_PATH or SOURCE_DATABASE_URL (see script header).",
		);
	}
	if (sourceUrl === localUrl) {
		throw new Error("SOURCE_DATABASE_URL must differ from local DATABASE_URL.");
	}

	const source = client(sourceUrl);
	try {
		const cache = await source.geocodeCache.findMany();
		const companies = await source.company.findMany({
			where: {
				OR: [
					{ latitude: { not: null } },
					{ geocodePlaceKey: { not: null } },
				],
			},
			select: {
				id: true,
				latitude: true,
				longitude: true,
				geocodePlaceKey: true,
				geocodedAt: true,
			},
		});
		return { cache, companies };
	} finally {
		await source.$disconnect();
	}
}

const dump = await loadDump();
const local = client(localUrl);

console.log(
	`Importing ${dump.cache.length} cache rows and ${dump.companies.length} companies…`,
);

let cacheUpserted = 0;
for (const row of dump.cache) {
	await local.geocodeCache.upsert({
		where: { placeKey: row.placeKey },
		create: {
			placeKey: row.placeKey,
			latitude: row.latitude,
			longitude: row.longitude,
			status: row.status,
			rawLabel: row.rawLabel,
			queriedAt: new Date(row.queriedAt),
		},
		update: {
			latitude: row.latitude,
			longitude: row.longitude,
			status: row.status,
			rawLabel: row.rawLabel,
			queriedAt: new Date(row.queriedAt),
		},
	});
	cacheUpserted += 1;
	if (cacheUpserted % 500 === 0) {
		console.log(`  cache ${cacheUpserted}/${dump.cache.length}`);
	}
}
console.log(`GeocodeCache upserted: ${cacheUpserted}`);

let updated = 0;
let missing = 0;
const BATCH = 200;
for (let i = 0; i < dump.companies.length; i += BATCH) {
	const slice = dump.companies.slice(i, i + BATCH);
	await Promise.all(
		slice.map(async (row) => {
			const result = await local.company.updateMany({
				where: { id: row.id },
				data: {
					latitude: row.latitude,
					longitude: row.longitude,
					geocodePlaceKey: row.geocodePlaceKey,
					geocodedAt: row.geocodedAt ? new Date(row.geocodedAt) : null,
				},
			});
			if (result.count === 0) missing += 1;
			else updated += result.count;
		}),
	);
	const done = Math.min(i + BATCH, dump.companies.length);
	if (done % 1000 === 0 || done === dump.companies.length) {
		console.log(
			`  companies ${done}/${dump.companies.length} (updated=${updated}, missingLocally=${missing})`,
		);
	}
}

const localHave = await local.company.count({
	where: { latitude: { not: null }, longitude: { not: null } },
});
console.log(`\nDone. Local companies with coords: ${localHave}`);
await local.$disconnect();
