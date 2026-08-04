/**
 * Pre-create a Better Auth user so they can sign in (signup is disabled).
 *
 * Idempotent by email. Does not set a password — they sign in with Microsoft
 * (or Google) and account-linking attaches the OAuth account.
 *
 *   bun run scripts/ensure-user.ts --email rjohnson@mobilemark.com --name "Robert Johnson"
 *   bun run scripts/ensure-user.ts --email … --name … --dry-run
 *
 * Prod (temporary TCP proxy — private DATABASE_URL is not reachable locally):
 *   railway tcp-proxy create --port 5432 --service Postgres
 *   MM_PROXY_HOST=… MM_PROXY_PORT=… railway run -s api -- \
 *     bun run scripts/run-via-tcp-proxy.ts ./ensure-user.ts --email … --name "…"
 *   railway tcp-proxy delete <id> --service Postgres --yes
 */
import "@crm/env/load";
import { db } from "@crm/db";
import { createHash } from "node:crypto";

function arg(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index < 0) return undefined;
	return process.argv[index + 1];
}

const dryRun = process.argv.includes("--dry-run");
const email = arg("--email")?.trim().toLowerCase();
const name = arg("--name")?.trim();

if (!email || !email.includes("@") || !name) {
	console.error(
		'Usage: bun run scripts/ensure-user.ts --email someone@mobilemark.com --name "Full Name"',
	);
	process.exit(1);
}

const existing = await db.user.findUnique({
	where: { email },
	select: { id: true, name: true, email: true, emailVerified: true },
});

if (existing) {
	console.log(
		JSON.stringify(
			{ dryRun, action: "exists", user: existing },
			null,
			2,
		),
	);
	await db.$disconnect();
	process.exit(0);
}

// Stable id so re-runs after a failed create do not mint a second identity.
const id = `invite-${createHash("sha256").update(email).digest("hex").slice(0, 24)}`;

const user = {
	id,
	email,
	name,
	emailVerified: true,
};

console.log(JSON.stringify({ dryRun, action: "create", user }, null, 2));

if (!dryRun) {
	await db.user.create({
		data: {
			...user,
			updatedAt: new Date(),
		},
	});
}

await db.$disconnect();
