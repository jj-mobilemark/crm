import { Injectable, Logger } from "@nestjs/common";

/**
 * What a Microsoft Graph call did.
 *
 * The interesting case is `cursor-invalid`: a delta token can expire or be
 * invalidated, and Graph answers a dead token with 410 Gone and a body code of
 * `SyncStateNotFound` / `resyncRequired` — sometimes a bare 404. All of those
 * mean "your cursor is gone, fall back to a bounded resync" rather than
 * "something broke".
 */
export type GraphResult<T> =
	| { outcome: "ok"; data: T }
	| { outcome: "cursor-invalid"; reason: string }
	| { outcome: "unauthorized"; reason: string }
	| { outcome: "rate-limited"; reason: string; retryAfterMs: number }
	| { outcome: "failed"; reason: string; retryable: boolean };

const DEFAULT_TIMEOUT_MS = 20_000;

/** Graph's own suggestion when it rate limits us, with a sane floor. */
const MIN_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

/** Graph error codes that mean the delta cursor has to be rebuilt. */
const RESYNC_CODES = /SyncStateNotFound|resyncRequired|SyncStateInvalid/i;

@Injectable()
export class GraphApiClient {
	private readonly logger = new Logger(GraphApiClient.name);

	/**
	 * A GET against a Microsoft Graph endpoint.
	 *
	 * `url` may be a bare endpoint or an absolute `@odata.nextLink` /
	 * `@odata.deltaLink`, which Graph returns fully-formed with their own query
	 * string. Extra `params` are merged on top, which is only used for the first
	 * call in a delta chain; following a link passes none.
	 *
	 * Deliberately `fetch` rather than the Graph SDK: we call a handful of
	 * endpoints, and a serverless bundle pays for every byte on every cold
	 * start.
	 */
	async get<T>(
		url: string,
		accessToken: string,
		params: Record<string, string | number | boolean | undefined> = {},
		headers: Record<string, string> = {},
	): Promise<GraphResult<T>> {
		const target = new URL(url);
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) target.searchParams.set(key, String(value));
		}

		return this.request<T>(target, accessToken, { method: "GET", headers });
	}

	/**
	 * A POST against a Microsoft Graph endpoint (e.g. `/me/sendMail`).
	 *
	 * Same outcome vocabulary as `get`. Empty 202 bodies (sendMail) return
	 * `ok` with `undefined as T` — callers that need a body should use an
	 * endpoint that returns one.
	 */
	async post<T>(
		url: string,
		accessToken: string,
		body: unknown,
		headers: Record<string, string> = {},
	): Promise<GraphResult<T>> {
		const target = new URL(url);
		return this.request<T>(target, accessToken, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...headers,
			},
			body: JSON.stringify(body),
		});
	}

	private async request<T>(
		target: URL,
		accessToken: string,
		init: {
			method: "GET" | "POST";
			headers?: Record<string, string>;
			body?: string;
		},
	): Promise<GraphResult<T>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

		try {
			const response = await fetch(target, {
				method: init.method,
				headers: { authorization: `Bearer ${accessToken}`, ...init.headers },
				body: init.body,
				signal: controller.signal,
			});

			return await this.interpret<T>(response, target.pathname);
		} catch (error) {
			const aborted = error instanceof Error && error.name === "AbortError";
			return {
				outcome: "failed",
				reason: aborted
					? `Timed out after ${DEFAULT_TIMEOUT_MS}ms.`
					: error instanceof Error
						? error.message
						: String(error),
				retryable: true,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private async interpret<T>(
		response: Response,
		path: string,
	): Promise<GraphResult<T>> {
		if (response.ok) {
			// sendMail answers 202 with an empty body; treat that as success.
			const text = await response.text();
			if (!text) {
				return { outcome: "ok", data: undefined as T };
			}
			return { outcome: "ok", data: JSON.parse(text) as T };
		}

		// Read the body for the reason, but never log it verbatim — Graph echoes
		// request parameters back in error messages, and those can carry
		// addresses.
		const { detail, code } = await this.reason(response);

		// A resync code can arrive on 410 or, occasionally, 400 — check it before
		// the status switch so the delta cursor is always reset rather than the
		// whole run being marked failed.
		if (RESYNC_CODES.test(`${code} ${detail}`)) {
			return { outcome: "cursor-invalid", reason: detail };
		}

		switch (response.status) {
			case 401:
				return { outcome: "unauthorized", reason: detail };

			// 404: the delta resource is gone. 410 Gone: the sync state expired.
			// Both mean the cursor is dead — resync from a bounded window.
			case 404:
			case 410:
				return { outcome: "cursor-invalid", reason: detail };

			case 403:
				// 403 is overloaded: throttling can look the same as a genuine
				// permission failure until you read the reason. Only the throttled
				// flavour is worth backing off for; the rest is terminal.
				if (/throttl|rate|quota|TooManyRequests/i.test(`${code} ${detail}`)) {
					return {
						outcome: "rate-limited",
						reason: detail,
						retryAfterMs: this.backoffFrom(response),
					};
				}
				return { outcome: "failed", reason: detail, retryable: false };

			case 429:
				return {
					outcome: "rate-limited",
					reason: detail,
					retryAfterMs: this.backoffFrom(response),
				};

			default: {
				const retryable = response.status >= 500;
				this.logger.warn({
					message: "Microsoft Graph call failed",
					path,
					status: response.status,
					retryable,
				});
				return { outcome: "failed", reason: detail, retryable };
			}
		}
	}

	private backoffFrom(response: Response): number {
		const header = response.headers.get("retry-after");
		const seconds = header ? Number(header) : Number.NaN;
		const suggested = Number.isFinite(seconds)
			? seconds * 1000
			: MIN_BACKOFF_MS;

		return Math.min(Math.max(suggested, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
	}

	private async reason(
		response: Response,
	): Promise<{ detail: string; code: string }> {
		try {
			const body = (await response.json()) as {
				error?: { message?: string; code?: string };
			};
			return {
				detail:
					body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`,
				code: body.error?.code ?? "",
			};
		} catch {
			return { detail: `HTTP ${response.status}`, code: "" };
		}
	}
}
