import "@crm/env/load";

/**
 * Who may override deal ownership rules (edit any deal, reassign owners).
 *
 * Optional. Empty / unset means nobody is an admin — every deal is owner-only.
 * Comma-separated email addresses (not domains):
 *
 * ```
 * CRM_ADMIN_EMAILS="jjohnson@mobilemark.com,other@mobilemark.com"
 * ```
 *
 * This is a thin seam until Better Auth roles land (`docs/crm-plan.md` §6).
 * Call sites should keep going through `isCrmAdmin` / `canEditOwnedRecord` so
 * a later `user.role` check can land in one place.
 */

let cachedSource: string | undefined;
let cached: readonly string[] = [];

function adminEmails(): readonly string[] {
	const source = process.env.CRM_ADMIN_EMAILS ?? "";
	if (source === cachedSource) return cached;

	const emails = source
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.includes("@"));

	cachedSource = source;
	cached = emails;
	return cached;
}

/** True when this address is listed in `CRM_ADMIN_EMAILS`. */
export function isCrmAdmin(email: string | null | undefined): boolean {
	const value = email?.trim().toLowerCase();
	if (!value) return false;
	return adminEmails().includes(value);
}

/**
 * Owner of the row, or a CRM admin.
 *
 * Admins can edit anything; everyone else only their own. Used for deal
 * field writes today — company/contact can adopt the same helper later.
 */
export function canEditOwnedRecord(args: {
	actingUserId: string;
	actingEmail: string | null | undefined;
	ownerId: string | null | undefined;
}): boolean {
	if (isCrmAdmin(args.actingEmail)) return true;
	if (!args.ownerId) return false;
	return args.actingUserId === args.ownerId;
}

/** Only admins reassign owners (plan: leave room for roles later). */
export function canReassignOwner(email: string | null | undefined): boolean {
	return isCrmAdmin(email);
}
