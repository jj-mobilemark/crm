import { MS_CALENDAR_SCOPE, MS_MAIL_SCOPE, MS_MAIL_SEND_SCOPE } from "@crm/auth";

/**
 * The scope strings come from `@crm/auth`, which is where the OAuth request is
 * actually made. Re-declaring them here would be two lists that drift, and the
 * failure is silent: the grant looks right and `isConnected()` says no.
 */
export {
	MS_CALENDAR_SCOPE,
	MS_MAIL_SCOPE,
	MS_MAIL_SEND_SCOPE,
	MS_SYNC_SCOPES,
} from "@crm/auth";

/**
 * The two sources sync independently: they have separate cursors, separate
 * failure modes and separate auto-create rules, so they get separate
 * `MailboxSync` rows rather than one row with two of everything.
 *
 * The strings are prefixed `outlook` so they never collide with Google's
 * `gmail` / `calendar` rows in the shared `MailboxSync` table.
 */
export const SYNC_SOURCES = ["outlook-calendar", "outlook"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

/** Which scope has to be granted for a source to be syncable. */
export const SCOPE_FOR_SOURCE: Record<SyncSource, string> = {
	outlook: MS_MAIL_SCOPE,
	"outlook-calendar": MS_CALENDAR_SCOPE,
};

/** Better Auth's provider id for the Microsoft social provider. */
export const MICROSOFT_PROVIDER_ID = "microsoft";

/**
 * How far back a contact-add backfill may reach.
 *
 * Config constant, not an env var — changing the window is a product decision,
 * not a self-hoster knob.
 */
export const BACKFILL_MAX_AGE_DAYS = 180;

/** Pages × page size ceiling for one address × one mailbox. */
export const BACKFILL_PAGE_SIZE = 50;
export const BACKFILL_MAX_PAGES = 5;

/** Addresses processed per sync tick so backfill cannot starve incremental sync. */
export const BACKFILL_MAX_PER_TICK = 3;
