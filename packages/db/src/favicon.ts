import dns from "node:dns/promises";
import net from "node:net";

const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000;

/**
 * A page can advertise as many `<link rel="icon">` tags as it likes, and each
 * one costs a HEAD request. Ten is more than any real site publishes and caps
 * a hostile one at eleven requests including the `/favicon.ico` fallback.
 */
const MAX_ICON_CANDIDATES = 10;

/** Enough for the usual apex-to-www or http-to-https hop, and no further. */
const MAX_REDIRECTS = 3;

/**
 * Addresses that must never be fetched.
 *
 * The domain on a company is attacker-supplied — anyone who can create a
 * company picks it — and this code runs inside the API, which can reach things
 * the internet cannot: cloud metadata on 169.254.169.254, Postgres on the
 * private network, anything bound to loopback. A `<link rel="icon">` pointing
 * at one of those turns "resolve a favicon" into a request forgery primitive,
 * so every hop is checked rather than only the domain we started from.
 */
export function isBlockedAddress(ip: string): boolean {
	const groups = ip.includes(":") ? expandIPv6(ip) : null;

	if (groups) {
		// An IPv4 address reachable through IPv6 is still that IPv4 address, and
		// the notation hides it: `::ffff:7f00:1` is loopback written in hex, and
		// a string comparison against "::ffff:127.0.0.1" never sees it. Both
		// mapped (`::ffff:0:0/96`) and compatible (`::/96`) forms carry the
		// address in the last 32 bits, so both are graded as IPv4.
		const marker = groups[5];
		if (
			groups.slice(0, 5).every((group) => group === 0) &&
			(marker === 0xffff || marker === 0)
		) {
			const high = groups[6] ?? 0;
			return isBlockedIPv4(high >> 8, high & 0xff);
		}

		const first = groups[0] ?? 0;
		return (
			(first & 0xfe00) === 0xfc00 || // unique local, fc00::/7
			(first & 0xffc0) === 0xfe80 || // link-local, fe80::/10
			(first & 0xff00) === 0xff00 // multicast, ff00::/8
		);
	}

	if (net.isIPv4(ip)) {
		const [a = 0, b = 0] = ip.split(".").map(Number);
		return isBlockedIPv4(a, b);
	}

	// Neither notation parsed, so we cannot say it is safe.
	return true;
}

/** Every range this blocks is decided by the first two octets. */
function isBlockedIPv4(a: number, b: number): boolean {
	return (
		a === 0 || // this network
		a === 10 || // private
		a === 127 || // loopback
		(a === 169 && b === 254) || // link-local, incl. cloud metadata
		(a === 172 && b >= 16 && b <= 31) || // private
		(a === 192 && b === 168) || // private
		(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
		(a === 198 && (b === 18 || b === 19)) || // benchmarking
		a >= 224 // multicast and reserved
	);
}

/**
 * An IPv6 address as its eight 16-bit groups, or `null` if it is not one.
 *
 * Written out rather than compared as text because every abbreviation is a way
 * to write loopback that a prefix check misses: `::1`, `0:0:0:0:0:0:0:1`,
 * `::ffff:127.0.0.1` and `::ffff:7f00:1` are the same address.
 */
function expandIPv6(ip: string): number[] | null {
	// A zone index (`fe80::1%eth0`) names an interface, not a different address.
	let text = (ip.split("%")[0] ?? "").toLowerCase();

	// A trailing dotted quad is the last two groups written in decimal.
	const embedded: number[] = [];
	const lastColon = text.lastIndexOf(":");
	const tail = text.slice(lastColon + 1);
	if (tail.includes(".")) {
		if (!net.isIPv4(tail)) return null;
		const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
		embedded.push((a << 8) | b, (c << 8) | d);
		text = text.slice(0, lastColon + 1);
	}

	const [headText = "", runText, extra] = text.split("::");
	if (extra !== undefined) return null;

	const parse = (part: string) =>
		part
			.split(":")
			.filter((group) => group !== "")
			.map((group) =>
				/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
			);

	const head = parse(headText);
	const run = runText === undefined ? [] : parse(runText);
	const missing = 8 - head.length - run.length - embedded.length;
	if (runText !== undefined && missing < 0) return null;

	const fill = runText === undefined ? [] : Array<number>(missing).fill(0);
	const groups = [...head, ...fill, ...run, ...embedded];
	if (groups.length !== 8 || groups.some((group) => Number.isNaN(group)))
		return null;

	return groups;
}

const ICON_REL = /^(shortcut )?icon$|^apple-touch-icon(-precomposed)?$/i;

function iconsFromHtml(html: string, base: URL): string[] {
	const found: { href: string; size: number }[] = [];

	for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
		const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.trim();
		if (!rel || !ICON_REL.test(rel)) continue;

		const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.trim();
		if (!href) continue;

		// "32x32" → 32. Unsized icons sort last rather than first: a declared
		// size is usually a real raster, and an undeclared one is often a 16px
		// .ico that looks like mud beside the artwork in the next row.
		const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];

		try {
			found.push({
				href: new URL(href, base).toString(),
				size: Number(sizes ?? 0),
			});
		} catch {
			// A malformed href is one skipped icon, not a failed resolve.
		}
	}

	return found.sort((a, b) => b.size - a.size).map((icon) => icon.href);
}

/**
 * Whether every address a hostname resolves to is publicly routable.
 *
 * Checked before each request rather than once up front, because a redirect
 * can send us somewhere else entirely.
 *
 * This does not close the DNS-rebinding window: the name is resolved here and
 * again by `fetch`, and an attacker who runs the authority for their own
 * company domain can answer differently the second time. Closing it means
 * connecting to the address that was checked, and **that is not available in
 * this runtime** — the API runs on Bun, whose `node:http` client ignores both
 * a custom `lookup` and `createConnection`, and whose `fetch` has no
 * dispatcher. Verified, not assumed: pinning through `lookup` works under Node
 * and under Bun drops SNI, fails certificate validation against the bare
 * address, and then silently re-resolves the name. The alternative is an
 * HTTP/1.1 client written by hand over `tls.connect`, which is a larger risk
 * than the one it removes.
 *
 * What is left needs an authenticated colleague — `ALLOWED_SIGN_IN` is the
 * whole door — who also controls authoritative DNS and wins a race. The
 * practical attack, an icon link pointing straight at an internal host, is
 * blocked on every hop.
 */
async function resolvesToPublicHost(hostname: string): Promise<boolean> {
	// A URL keeps the brackets on an IPv6 literal; `net.isIP` will not take them.
	const literal = hostname.replace(/^\[|\]$/g, "");
	if (net.isIP(literal)) return !isBlockedAddress(literal);

	// The lookup carries the same deadline as the request it precedes. An abort
	// signal on the fetch covers neither this nor the fetch's own resolution, so
	// without it a resolver hanging under a network partition holds a
	// fire-and-forget backfill open indefinitely rather than degrading to null.
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const addresses = await Promise.race([
			dns.lookup(hostname, { all: true }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${hostname} did not resolve in time`)),
					TIMEOUT_MS,
				);
			}),
		]);

		return (
			addresses.length > 0 &&
			addresses.every((address) => !isBlockedAddress(address.address))
		);
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * A fetch that refuses to leave the public internet.
 *
 * Redirects are followed by hand — `redirect: "follow"` would chase a `Location`
 * into the private network without ever showing it to us, which is exactly the
 * hop that needs checking.
 */
async function request(
	url: string,
	method: "GET" | "HEAD" = "GET",
): Promise<{ response: Response; url: URL } | null> {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return null;
	}

	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		// Anything that is not plain HTTP can address things a browser would not:
		// file://, and the gopher/dict tricks that turn a fetcher into a client
		// for whatever is listening on an internal port.
		if (target.protocol !== "https:" && target.protocol !== "http:")
			return null;
		if (!(await resolvesToPublicHost(target.hostname))) return null;

		let response: Response;
		try {
			response = await fetch(target, {
				method,
				signal: AbortSignal.timeout(TIMEOUT_MS),
				redirect: "manual",
				// Some origins serve a different page, or none, to an unknown agent.
				headers: { "user-agent": "Mozilla/5.0 (compatible; CRM/1.0)" },
			});
		} catch {
			return null;
		}

		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			try {
				target = new URL(location, target);
			} catch {
				return null;
			}
			continue;
		}

		return { response, url: target };
	}

	return null;
}

/**
 * The page's HTML and the URL it ended up at, after redirects.
 *
 * Read a chunk at a time and cancelled at the cap, rather than `await
 * response.text()` and then slicing: slicing throws the excess away only after
 * the whole body is already in memory, so a hostile origin streaming gigabytes
 * would exhaust the API before the limit was ever applied.
 */
async function readPage(url: URL): Promise<{ body: string; url: URL } | null> {
	const result = await request(url.toString());
	if (!result?.response.ok) return null;

	const { response } = result;
	if (!(response.headers.get("content-type") ?? "").includes("html")) {
		await response.body?.cancel();
		return null;
	}
	if (!response.body) return null;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = "";
	let bytes = 0;

	try {
		while (bytes < MAX_HTML_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			body += decoder.decode(value, { stream: true });
		}
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => {});
	}

	return { body, url: result.url };
}

/**
 * Whether a URL actually serves an image.
 *
 * Checked because a great many sites answer `/favicon.ico` with a 200 and an
 * HTML error page, and storing that URL puts a broken image in every table row
 * — the one outcome worse than the placeholder it replaced.
 */
async function servesImage(url: string): Promise<boolean> {
	const result = await request(url, "HEAD");
	if (!result?.response.ok) return false;

	await result.response.body?.cancel();
	return (result.response.headers.get("content-type") ?? "").startsWith(
		"image/",
	);
}

/**
 * The best icon a domain advertises, or `null`.
 *
 * Never throws and never guesses: `null` is a real answer and the safe one,
 * because a company with no icon is the state we were already in.
 */
export async function resolveFavicon(
	domain: string | null | undefined,
): Promise<string | null> {
	if (!domain) return null;

	try {
		const base = new URL(`https://${domain}`);
		const page = await readPage(base);

		// Capped before the fallback is appended, so a page listing a thousand
		// icons cannot turn one company lookup into a thousand HEAD requests.
		const candidates = page
			? iconsFromHtml(page.body, page.url).slice(0, MAX_ICON_CANDIDATES)
			: [];
		// Every site is entitled to this path whether it advertises it or not,
		// so it is the last candidate rather than a separate branch.
		candidates.push(new URL("/favicon.ico", page?.url ?? base).toString());

		for (const candidate of candidates) {
			if (await servesImage(candidate)) return candidate;
		}
	} catch {
		// A domain that does not parse is a null, like one that does not answer.
	}

	return null;
}
