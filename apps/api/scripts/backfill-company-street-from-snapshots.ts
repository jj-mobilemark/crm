/**
 * One-time: fill Company.streetAddress + postalCode from SageRecordSnapshot.
 *
 * The first full Sage pull stored nested address (including address1 /
 * postcode) in snapshots, but mapCompany only copied city/state/country.
 * This reads those snapshots — no Sage SOAP calls.
 *
 * Idempotent: only fills null columns; never overwrites a set value.
 *
 *   bun run scripts/backfill-company-street-from-snapshots.ts --dry-run
 *   bun run scripts/backfill-company-street-from-snapshots.ts
 */
import "@crm/env/load";
import { db } from "@crm/db";

const CHUNK = 200;
const SAMPLE = 50;
const DRY_RUN = process.argv.includes("--dry-run");

type SnapshotAddress = {
	sageId: string;
	address1: string | null;
	postcode: string | null;
	zip: string | null;
	zipcode: string | null;
};

function clean(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function postalFrom(row: SnapshotAddress): string | null {
	return clean(row.postcode) ?? clean(row.zip) ?? clean(row.zipcode);
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

async function main(): Promise<void> {
	const sample = await db.$queryRaw<SnapshotAddress[]>`
		SELECT
			"sageId",
			payload->'address'->>'address1' AS address1,
			payload->'address'->>'postcode' AS postcode,
			payload->'address'->>'zip' AS zip,
			payload->'address'->>'zipcode' AS zipcode
		FROM "sageRecordSnapshot"
		WHERE entity = 'company'
		ORDER BY "updatedAt" DESC
		LIMIT ${SAMPLE}
	`;

	const sampleWithStreet = sample.filter((r) => clean(r.address1)).length;
	const sampleWithPostal = sample.filter((r) => postalFrom(r)).length;
	console.log(
		`Snapshot sample (n=${sample.length}): street=${sampleWithStreet}, postal=${sampleWithPostal}`,
	);
	if (sample.length > 0 && sampleWithStreet === 0) {
		console.warn(
			"No address1 in sample — quoting-tool dump may be needed. Aborting.",
		);
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
		},
	});
	const companyBySageId = new Map(
		companies.map((c) => [c.sageCrmCompanyId as string, c]),
	);

	const rows = await db.$queryRaw<SnapshotAddress[]>`
		SELECT
			"sageId",
			payload->'address'->>'address1' AS address1,
			payload->'address'->>'postcode' AS postcode,
			payload->'address'->>'zip' AS zip,
			payload->'address'->>'zipcode' AS zipcode
		FROM "sageRecordSnapshot"
		WHERE entity = 'company'
	`;

	type Patch = { id: string; streetAddress?: string; postalCode?: string };
	const patches: Patch[] = [];
	let skipAlreadyFilled = 0;
	let skipNoAddress = 0;

	for (const row of rows) {
		const company = companyBySageId.get(row.sageId);
		if (!company) continue;

		const street = clean(row.address1);
		const postal = postalFrom(row);
		if (!street && !postal) {
			skipNoAddress += 1;
			continue;
		}

		const needStreet = !company.streetAddress && street;
		const needPostal = !company.postalCode && postal;
		if (!needStreet && !needPostal) {
			skipAlreadyFilled += 1;
			continue;
		}

		patches.push({
			id: company.id,
			...(needStreet && street ? { streetAddress: street } : {}),
			...(needPostal && postal ? { postalCode: postal } : {}),
		});
	}

	console.log(
		`Candidates: ${patches.length} (skip filled=${skipAlreadyFilled}, no address=${skipNoAddress})`,
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
