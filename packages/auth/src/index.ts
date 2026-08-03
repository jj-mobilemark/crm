export {
	canEditOwnedRecord,
	canReassignOwner,
	isCrmAdmin,
} from "./admins";
export { type Auth, auth, type Session, type SessionUser } from "./auth";
export {
	CALENDAR_SCOPE,
	GMAIL_SCOPE,
	hasMsSyncScopes,
	hasSyncScopes,
	IDENTITY_SCOPES,
	MS_CALENDAR_SCOPE,
	MS_MAIL_SCOPE,
	MS_SYNC_SCOPES,
	parseScopes,
	REQUIRED_SCOPES,
	SYNC_SCOPES,
} from "./scopes";
export {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
	workspaceDomains,
} from "./workspace";
