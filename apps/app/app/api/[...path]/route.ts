import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { INTERNAL_API_URL } from "@/lib/env";

/**
 * Same-origin passthrough to the NestJS API.
 *
 * Without it every tRPC call from the browser would be a cross-origin,
 * credentialed request: CORS preflights, `SameSite` cookie rules and third-party
 * cookie blocking all become problems the moment the app and the API are not on
 * the same host. Forwarding through the app makes `/api/trpc` look local, and
 * the session cookie just works.
 *
 * Upstream is `INTERNAL_API_URL`, not the public API origin — server→Cloudflare
 * hairpins return HTML error pages that the tRPC client then fails to parse.
 */

/**
 * `undici` transparently decompresses some responses and not others, so the
 * bytes we hold may or may not still be encoded. Try to decode; if it throws,
 * they were already plain.
 */
function decode(buf: Buffer, encoding: string | null): Buffer {
	const enc = (encoding ?? "").toLowerCase();
	try {
		if (enc.includes("br")) return brotliDecompressSync(buf);
		if (enc.includes("gzip")) return gunzipSync(buf);
		if (enc.includes("deflate")) return inflateSync(buf);
	} catch {
		// Already decompressed upstream.
	}
	return buf;
}

async function handler(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const target = `${INTERNAL_API_URL}${url.pathname}${url.search}`;

	const headers = new Headers(request.headers);
	// Hop-by-hop and origin-describing headers belong to the browser→app hop,
	// not the app→API one. Leaving them on makes the API think it is behind a
	// proxy it is not, and re-sending `content-length` after we have touched the
	// body is a truncated request.
	for (const header of [
		"host",
		"x-forwarded-host",
		"x-forwarded-proto",
		"x-forwarded-for",
		"forwarded",
		"transfer-encoding",
		"connection",
		"keep-alive",
		"content-length",
		"expect",
	]) {
		headers.delete(header);
	}

	const init: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers,
		redirect: "manual",
	};

	if (request.method !== "GET" && request.method !== "HEAD") {
		init.body = request.body;
		init.duplex = "half";
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, init);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "API proxy fetch failed";
		return Response.json(
			{
				error: {
					message: `Could not reach the API at ${INTERNAL_API_URL}: ${message}`,
					code: -32603,
					data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 502 },
				},
			},
			{ status: 502 },
		);
	}

	const responseHeaders = new Headers(upstream.headers);
	for (const header of [
		"transfer-encoding",
		"connection",
		"content-encoding",
		"content-length",
	]) {
		responseHeaders.delete(header);
	}

	// `Headers` folds repeated values into one comma-joined string, which mangles
	// cookies. `getSetCookie()` is the only way to keep them separate.
	const setCookies = upstream.headers.getSetCookie?.() ?? [];
	if (setCookies.length > 0) {
		responseHeaders.delete("set-cookie");
		for (const cookie of setCookies) {
			responseHeaders.append("set-cookie", cookie);
		}
	}

	// Streams pass straight through — buffering an SSE response would hold it
	// open forever and deliver nothing.
	if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: responseHeaders,
		});
	}

	const raw = Buffer.from(await upstream.arrayBuffer());
	const body = decode(raw, upstream.headers.get("content-encoding"));

	// CDN / gateway HTML (Cloudflare Error 1000, 502 pages, …) must not reach the
	// tRPC client as a "successful" body — it surfaces as a JSON parse toast.
	const contentType = upstream.headers.get("content-type") ?? "";
	const head = body.subarray(0, 32).toString("utf8").trimStart().toLowerCase();
	const looksHtml =
		contentType.includes("text/html") ||
		head.startsWith("<!doctype") ||
		head.startsWith("<html");
	if (looksHtml) {
		return Response.json(
			{
				error: {
					message:
						"API proxy received an HTML error page instead of JSON. Set INTERNAL_API_URL to the private API origin (Railway: http://api.railway.internal:3001).",
					code: -32603,
					data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 502 },
				},
			},
			{ status: 502 },
		);
	}

	return new Response(new Uint8Array(body), {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
}

export {
	handler as DELETE,
	handler as GET,
	handler as HEAD,
	handler as OPTIONS,
	handler as PATCH,
	handler as POST,
	handler as PUT,
};
