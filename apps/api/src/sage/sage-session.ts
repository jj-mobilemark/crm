import type { Db } from "@crm/db";
import type { SageSoapClient } from "./sage-soap.client";
import { SAGE_SESSION_LOCK_KEY } from "./sage.constants";

/**
 * Result of trying to run inside the single global Sage session.
 *
 * `busy` means another holder (test-slice, cron, worker, or push) already has
 * the lock — the caller must not open a second Sage session.
 */
export type SageSessionResult<T> =
	| { outcome: "busy" }
	| { outcome: "ran"; value: T };

/**
 * Run `work` while holding the one global Sage session.
 *
 * Wraps a Postgres advisory lock so no two callers ever hold two Sage sessions
 * at once (a second `logon` KICKS the first). Always `logoff`s and unlocks in a
 * finally. This is the real guard that replaces the old in-process `running`
 * flag — it is cross-process, which the flag was not.
 *
 * Caveat: a session-level advisory lock is bound to the Postgres connection it
 * was taken on. With a connection pool the explicit unlock may land on a
 * different backend and no-op; the lock then releases when that backend closes.
 * For the standalone backfill script (a short-lived process) this is fine —
 * process exit drops every connection and every lock. When the long-lived API
 * host also runs Sage jobs, prefer a lease row so a pooled connection cannot
 * strand the lock.
 */
export async function withSageSession<T>(
	db: Db,
	soap: SageSoapClient,
	work: () => Promise<T>,
): Promise<SageSessionResult<T>> {
	const locked = await tryLock(db);
	if (!locked) return { outcome: "busy" };

	try {
		const value = await work();
		return { outcome: "ran", value };
	} finally {
		await soap.logoff();
		await unlock(db);
	}
}

async function tryLock(db: Db): Promise<boolean> {
	const rows = await db.$queryRaw<{ locked: boolean }[]>`
		SELECT pg_try_advisory_lock(${SAGE_SESSION_LOCK_KEY}) AS locked
	`;
	return rows[0]?.locked === true;
}

async function unlock(db: Db): Promise<void> {
	try {
		await db.$queryRaw`SELECT pg_advisory_unlock(${SAGE_SESSION_LOCK_KEY})`;
	} catch {
		// A stranded lock releases when the connection closes; never surface this.
	}
}
