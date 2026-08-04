/**
 * Fill Company address columns from SageRecordSnapshot (no SOAP).
 *
 * Covers street / postal (first pass) plus state / country — the full pull
 * only wrote `city`, and `/map` started persisting state/country later, so
 * most rows still have nulls while snapshots already hold the nested address.
 *
 * Idempotent: only fills null columns; never overwrites a set value.
 * Does not clear geocode (city pins stay put when state/country fill in).
 *
 *   bun run scripts/backfill-company-street-from-snapshots.ts --dry-run
 *   bun run scripts/backfill-company-street-from-snapshots.ts
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { mapCompanyTree } from "../src/sage/sage.mappings";
import type { SageCompanyTree, SageRecord } from "../src/sage/sage-xml";

const CHUNK = 200;
const SAMPLE = 50;
const DRY_RUN = process.argv.includes("--dry-run");

type SnapshotRow = {
	sageId: string;
	payload: unknown;
};

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

function asRecord(value: unknown): SageRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const out: SageRecord = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw === "string") out[key] = raw;
		else if (raw != null && typeof raw !== "object") out[key] = String(raw);
	}
	return out;
}

function treeFromPayload(payload: unknown): SageCompanyTree | null {
	if (!payload || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;
	const company = asRecord(p.company);
	if (!company) return null;
	return {
		company,
		people: [],
		address: asRecord(p.address),
		email: asRecord(p.email),
		phone: asRecord(p.phone),
	};
}

type Patch = {
	id: string;
	streetAddress?: string;
	postalCode?: string;
	stateCode?: string;
	country?: string;
	countryCode?: string;
};

async function main(): Promise<void> {
	const sampleRows = await db.sageRecordSnapshot.findMany({
		where: { entity: "company" },
		orderBy: { updatedAt: "desc" },
		take: SAMPLE,
		select: { sageId: true, payload: true },
	});

	let sampleStreet = 0;
	let sampleState = 0;
	let sampleCountry = 0;
	for (const row of sampleRows) {
		const tree = treeFromPayload(row.payload);
		const mapped = tree ? mapCompanyTree(tree) : null;
		if (mapped?.streetAddress) sampleStreet += 1;
		if (mapped?.stateCode) sampleState += 1;
		if (mapped?.country) sampleCountry += 1;
	}
	console.log(
		`Snapshot sample (n=${sampleRows.length}): street=${sampleStreet}, state=${sampleState}, country=${sampleCountry}`,
	);
	if (sampleRows.length > 0 && sampleStreet === 0 && sampleState === 0) {
		console.warn("No address fields in sample — aborting.");
		await db.$disconnect();
		process.exit(1);
	}

	const companies = await db.company.findMany({
		where: { sageCrmCompanyId: { not: null } },
		select: {
			id: true,
			sageCrmCompanyId: true,
			streetAddress: true,
			postalCode: true,
			stateCode: true,
			country: true,
			countryCode: true,
		},
	});
	const companyBySageId = new Map(
		companies.map((c) => [c.sageCrmCompanyId as string, c]),
	);

	const snapshots = await db.sageRecordSnapshot.findMany({
		where: { entity: "company" },
		select: { sageId: true, payload: true },
	});

	const patches: Patch[] = [];
	let skipAlreadyFilled = 0;
	let skipNoMapped = 0;

	for (const row of snapshots as SnapshotRow[]) {
		const company = companyBySageId.get(row.sageId);
		if (!company) continue;

		const tree = treeFromPayload(row.payload);
		const mapped = tree ? mapCompanyTree(tree) : null;
		if (!mapped) {
			skipNoMapped += 1;
			continue;
		}

		const needStreet = !company.streetAddress && mapped.streetAddress;
		const needPostal = !company.postalCode && mapped.postalCode;
		const needState = !company.stateCode && mapped.stateCode;
		const needCountry = !company.country && mapped.country;
		const needCountryCode = !company.countryCode && mapped.countryCode;

		if (
			!needStreet &&
			!needPostal &&
			!needState &&
			!needCountry &&
			!needCountryCode
		) {
			skipAlreadyFilled += 1;
			continue;
		}

		patches.push({
			id: company.id,
			...(needStreet && mapped.streetAddress
				? { streetAddress: mapped.streetAddress }
				: {}),
			...(needPostal && mapped.postalCode
				? { postalCode: mapped.postalCode }
				: {}),
			...(needState && mapped.stateCode ? { stateCode: mapped.stateCode } : {}),
			...(needCountry && mapped.country ? { country: mapped.country } : {}),
			...(needCountryCode && mapped.countryCode
				? { countryCode: mapped.countryCode }
				: {}),
		});
	}

	console.log(
		`Candidates: ${patches.length} (skip filled=${skipAlreadyFilled}, no mapped=${skipNoMapped})`,
	);
	if (DRY_RUN) {
		console.log("Dry run — no writes.");
		for (const p of patches.slice(0, 5)) {
			console.log("  sample:", p);
		}
		await db.$disconnect();
		return;
	}

	let updated = 0;
	for (const batch of chunk(patches, CHUNK)) {
		await Promise.all(
			batch.map((p) =>
				db.company.update({
					where: { id: p.id },
					data: {
						...(p.streetAddress !== undefined
							? { streetAddress: p.streetAddress }
							: {}),
						...(p.postalCode !== undefined
							? { postalCode: p.postalCode }
							: {}),
						...(p.stateCode !== undefined ? { stateCode: p.stateCode } : {}),
						...(p.country !== undefined ? { country: p.country } : {}),
						...(p.countryCode !== undefined
							? { countryCode: p.countryCode }
							: {}),
					},
				}),
			),
		);
		updated += batch.length;
		if (updated % 1000 === 0 || updated === patches.length) {
			console.log(`  updated ${updated}/${patches.length}`);
		}
	}

	console.log(`Done. Updated ${updated} companies.`);
	await db.$disconnect();
}

void main().catch(async (error: unknown) => {
	console.error(error);
	await db.$disconnect();
	process.exit(1);
});
