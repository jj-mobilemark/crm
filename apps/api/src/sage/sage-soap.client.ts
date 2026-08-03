import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { type SageCredentials, sageCredentials } from "./sage.config";
import {
	SAGE_REQUEST_NS,
	SAGE_REQUEST_TIMEOUT_MS,
	type SageEntity,
} from "./sage.constants";
import {
	parseCompanyPage,
	parseFault,
	parseQueryPage,
	parseSessionId,
	type SageCompanyTree,
	type SageRecord,
} from "./sage-xml";

/**
 * What a Sage SOAP call did. Mirrors `GraphResult`: outcomes, never throws.
 *
 * `auth-failed` means the logon itself was rejected (bad credentials) — distinct
 * from `not-configured` (no credentials at all) and from a transient `failed`.
 */
export type SageResult<T> =
	| { outcome: "ok"; data: T }
	| { outcome: "not-configured"; reason: string }
	| { outcome: "auth-failed"; reason: string }
	| { outcome: "failed"; reason: string; retryable: boolean };

/** One page of flat records (query or next). */
export type SageRecordPage = {
	records: SageRecord[];
	more: boolean;
};

/** One page of hierarchical companies (query or next). */
export type SageCompanyTreePage = {
	companies: SageCompanyTree[];
	more: boolean;
};

/**
 * Thin SOAP client for Sage CRM's `eware.dll` web service.
 *
 * Deliberately `fetch` + hand-built envelopes rather than a WSDL/SOAP library:
 * the WSDL is not served (a GET returns empty), the surface we use is
 * `logon` / `query` / `next` / `logoff`, and the message shapes are fixed and
 * confirmed against production. See `docs/plans/sage-crm-sync.md`.
 *
 * The session id from `logon` is cached and reused; a session-related fault
 * triggers exactly one re-logon and retry. Only ONE Web Services session may
 * be open at a time on the Sage server — callers must serialize and always
 * `logoff` in a finally.
 */
@Injectable()
export class SageSoapClient {
	private readonly logger = new Logger(SageSoapClient.name);
	private readonly creds: SageCredentials | undefined;
	private sessionId: string | undefined;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.creds = sageCredentials({
			SAGE_SOAP_URL: config.get("SAGE_SOAP_URL", { infer: true }),
			SAGE_SOAP_USER: config.get("SAGE_SOAP_USER", { infer: true }),
			SAGE_SOAP_PASSWORD: config.get("SAGE_SOAP_PASSWORD", { infer: true }),
		});
	}

	/** Whether Sage credentials are present; the sync is off when they are not. */
	isConfigured(): boolean {
		return this.creds !== undefined;
	}

	/**
	 * Query an entity with a Sage predicate (DB-column syntax, e.g.
	 * `comp_name like 'Mobile Mark%'`). Returns the top-level records only —
	 * nested child collections are dropped (use `queryCompanies` for the
	 * hierarchical company backfill).
	 */
	async query(
		entity: SageEntity,
		predicate: string,
	): Promise<SageResult<SageRecord[]>> {
		const page = await this.queryPage(entity, predicate);
		if (page.outcome !== "ok") return page;
		return { outcome: "ok", data: page.data.records };
	}

	/**
	 * One page of flat records plus Sage's `<more>` flag.
	 *
	 * Call `nextPage` while `more` is true — pagination is session-stateful.
	 */
	async queryPage(
		entity: SageEntity,
		predicate: string,
	): Promise<SageResult<SageRecordPage>> {
		if (!this.creds) {
			return {
				outcome: "not-configured",
				reason: "Sage SOAP is not configured.",
			};
		}

		const session = await this.ensureSession();
		if (session.outcome !== "ok") return session;

		const first = await this.runQuery(entity, predicate, session.data);
		if (first.outcome === "ok") return first;

		if (first.outcome === "failed" && first.retryable) {
			this.sessionId = undefined;
			const retrySession = await this.ensureSession();
			if (retrySession.outcome !== "ok") return retrySession;
			return this.runQuery(entity, predicate, retrySession.data);
		}

		return first;
	}

	/**
	 * Hierarchical company query: each company plus nested people / address /
	 * email / phone. This is the backfill path — do NOT query `person`
	 * separately for a company walk.
	 */
	async queryCompanies(
		predicate: string,
	): Promise<SageResult<SageCompanyTreePage>> {
		if (!this.creds) {
			return {
				outcome: "not-configured",
				reason: "Sage SOAP is not configured.",
			};
		}

		const session = await this.ensureSession();
		if (session.outcome !== "ok") return session;

		const first = await this.runCompanyQuery(predicate, session.data);
		if (first.outcome === "ok") return first;

		if (first.outcome === "failed" && first.retryable) {
			this.sessionId = undefined;
			const retrySession = await this.ensureSession();
			if (retrySession.outcome !== "ok") return retrySession;
			return this.runCompanyQuery(predicate, retrySession.data);
		}

		return first;
	}

	/**
	 * Next page of the open query (empty body, same session).
	 *
	 * Returns flat records. Prefer `nextCompanies` after `queryCompanies`.
	 */
	async nextPage(entity: SageEntity): Promise<SageResult<SageRecordPage>> {
		return this.runNext((xml) => parseQueryPage(xml, entity));
	}

	/** Next page of a hierarchical company query. */
	async nextCompanies(): Promise<SageResult<SageCompanyTreePage>> {
		return this.runNext((xml) => parseCompanyPage(xml));
	}

	/**
	 * Walk every page of a company query via `query` -> `next` while
	 * `<more>true</more>`. Holds the session for the whole walk — caller must
	 * `logoff` when done. Not for the full ~14k backfill inside a web request.
	 */
	async queryAllCompanies(
		predicate: string,
	): Promise<SageResult<SageCompanyTree[]>> {
		const first = await this.queryCompanies(predicate);
		if (first.outcome !== "ok") return first;

		const all = [...first.data.companies];
		let more = first.data.more;

		while (more) {
			const page = await this.nextCompanies();
			if (page.outcome !== "ok") return page;
			all.push(...page.data.companies);
			more = page.data.more;
		}

		return { outcome: "ok", data: all };
	}

	/** Best-effort session teardown; failures are swallowed. */
	async logoff(): Promise<void> {
		if (!this.creds || !this.sessionId) return;
		const body = `<tem:logoff/>`;
		try {
			await this.post("logoff", this.envelope(body, this.sessionId));
		} catch {
			// A dangling session on Sage's side is harmless; do not surface it.
		} finally {
			this.sessionId = undefined;
		}
	}

	private async ensureSession(): Promise<SageResult<string>> {
		if (this.sessionId) return { outcome: "ok", data: this.sessionId };
		if (!this.creds) {
			return {
				outcome: "not-configured",
				reason: "Sage SOAP is not configured.",
			};
		}

		const body =
			`<tem:logon>` +
			`<tem:Username>${escapeXml(this.creds.user)}</tem:Username>` +
			`<tem:Password>${escapeXml(this.creds.password)}</tem:Password>` +
			`</tem:logon>`;

		const response = await this.post("logon", this.envelope(body));
		if (response.outcome !== "ok") return response;

		const fault = parseFault(response.data);
		if (fault) return { outcome: "auth-failed", reason: fault };

		const sessionId = parseSessionId(response.data);
		if (!sessionId) {
			return {
				outcome: "auth-failed",
				reason: "Sage logon returned no session id.",
			};
		}

		this.sessionId = sessionId;
		return { outcome: "ok", data: sessionId };
	}

	private async runQuery(
		entity: SageEntity,
		predicate: string,
		sessionId: string,
	): Promise<SageResult<SageRecordPage>> {
		const response = await this.postQuery(entity, predicate, sessionId);
		if (response.outcome !== "ok") return response;
		return {
			outcome: "ok",
			data: parseQueryPage(response.data, entity),
		};
	}

	private async runCompanyQuery(
		predicate: string,
		sessionId: string,
	): Promise<SageResult<SageCompanyTreePage>> {
		const response = await this.postQuery("company", predicate, sessionId);
		if (response.outcome !== "ok") return response;
		return { outcome: "ok", data: parseCompanyPage(response.data) };
	}

	private async postQuery(
		entity: SageEntity,
		predicate: string,
		sessionId: string,
	): Promise<SageResult<string>> {
		const body =
			`<tem:query>` +
			`<tem:queryString>${escapeXml(predicate)}</tem:queryString>` +
			`<tem:Entity>${escapeXml(entity)}</tem:Entity>` +
			`</tem:query>`;

		const response = await this.post("query", this.envelope(body, sessionId));
		if (response.outcome !== "ok") return response;

		const fault = parseFault(response.data);
		if (fault) {
			this.logger.warn({ message: "Sage query fault", entity, fault });
			return { outcome: "failed", reason: fault, retryable: true };
		}

		return { outcome: "ok", data: response.data };
	}

	private async runNext<T>(
		parse: (xml: string) => T,
	): Promise<SageResult<T>> {
		if (!this.creds) {
			return {
				outcome: "not-configured",
				reason: "Sage SOAP is not configured.",
			};
		}
		if (!this.sessionId) {
			return {
				outcome: "failed",
				reason: "No open Sage session for next().",
				retryable: false,
			};
		}

		const body = `<tem:next/>`;
		const response = await this.post(
			"next",
			this.envelope(body, this.sessionId),
		);
		if (response.outcome !== "ok") return response;

		const fault = parseFault(response.data);
		if (fault) {
			this.logger.warn({ message: "Sage next fault", fault });
			return { outcome: "failed", reason: fault, retryable: true };
		}

		return { outcome: "ok", data: parse(response.data) };
	}

	/** POST one SOAP envelope; maps transport/HTTP problems onto SageResult. */
	private async post(
		action: "logon" | "query" | "next" | "logoff",
		envelope: string,
	): Promise<SageResult<string>> {
		if (!this.creds) {
			return {
				outcome: "not-configured",
				reason: "Sage SOAP is not configured.",
			};
		}

		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			SAGE_REQUEST_TIMEOUT_MS,
		);

		try {
			const response = await fetch(this.creds.url, {
				method: "POST",
				headers: {
					"content-type": "text/xml; charset=utf-8",
					soapaction: `"${SAGE_REQUEST_NS}${action}"`,
				},
				body: envelope,
				signal: controller.signal,
			});

			const text = await response.text();
			if (!response.ok) {
				this.logger.warn({
					message: "Sage SOAP HTTP error",
					action,
					status: response.status,
				});
				return {
					outcome: "failed",
					reason: `HTTP ${response.status}`,
					retryable: response.status >= 500,
				};
			}

			return { outcome: "ok", data: text };
		} catch (error) {
			const aborted = error instanceof Error && error.name === "AbortError";
			return {
				outcome: "failed",
				reason: aborted
					? `Sage SOAP timed out after ${SAGE_REQUEST_TIMEOUT_MS}ms.`
					: error instanceof Error
						? error.message
						: String(error),
				retryable: true,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private envelope(body: string, sessionId?: string): string {
		const header = sessionId
			? `<soap:Header><tem:sessionheader><tem:sessionid>${escapeXml(sessionId)}</tem:sessionid></tem:sessionheader></soap:Header>`
			: "";
		return (
			`<?xml version="1.0" encoding="utf-8"?>` +
			`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="${SAGE_REQUEST_NS}">` +
			`${header}<soap:Body>${body}</soap:Body>` +
			`</soap:Envelope>`
		);
	}
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
