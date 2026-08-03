import type { Db } from "@crm/db";
import { SAGE_USERS } from "./sage.mappings";

export type EnsureSageUsersSummary = {
	created: number;
	updated: number;
};

/**
 * Pre-create the Sage CRM users as local `User` rows, idempotently.
 *
 * A `Deal.ownerId` is required and non-null, so the backfill needs a local user
 * for every Sage `assigneduserid` before it imports opportunities. This mirrors
 * `seedOwners()` in `packages/db/prisma/seed.ts`: a stable id
 * (`sage-user-<sageId>`), keyed by `email`, `emailVerified: true`. Re-running is
 * safe — an existing user (by email) keeps its id and is only refreshed.
 *
 * Renaming a rep in the app is not clobbered on a re-run: we upsert by email but
 * only set the name on create, leaving a human-edited name alone.
 */
export async function ensureSageUsers(db: Db): Promise<EnsureSageUsersSummary> {
	let created = 0;
	let updated = 0;

	for (const user of SAGE_USERS) {
		const existing = await db.user.findUnique({
			where: { email: user.email },
			select: { id: true },
		});

		if (existing) {
			updated += 1;
			continue;
		}

		await db.user.create({
			data: {
				id: `sage-user-${user.sageId}`,
				email: user.email,
				name: `${user.firstName} ${user.lastName}`.trim(),
				emailVerified: true,
				updatedAt: new Date(),
			},
		});
		created += 1;
	}

	return { created, updated };
}
