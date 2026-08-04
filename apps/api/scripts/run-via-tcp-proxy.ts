/**
 * Run a local script against Railway Postgres via a temporary TCP proxy.
 *
 * `railway run` injects the private DATABASE_URL (*.railway.internal), which
 * is not reachable from a laptop. Set MM_PROXY_HOST / MM_PROXY_PORT from
 * `railway tcp-proxy create` first, then from apps/api:
 *
 *   MM_PROXY_HOST=… MM_PROXY_PORT=… railway run -s api -- \
 *     bun run scripts/run-via-tcp-proxy.ts ./fix-sage-website-notes.ts --dry-run
 */
const host = process.env.MM_PROXY_HOST?.trim();
const port = process.env.MM_PROXY_PORT?.trim();
if (!host || !port) {
	throw new Error("MM_PROXY_HOST and MM_PROXY_PORT are required");
}

const raw = process.env.DATABASE_URL;
if (!raw) {
	throw new Error("DATABASE_URL is required (use railway run -s api)");
}

const url = new URL(raw);
url.hostname = host;
url.port = port;
process.env.DATABASE_URL = url.toString();

const target = process.argv[2];
if (!target) {
	throw new Error(
		"Usage: bun run scripts/run-via-tcp-proxy.ts <./script.ts> [...args]",
	);
}

process.argv = [process.argv[0], target, ...process.argv.slice(3)];

await import(new URL(target, import.meta.url).href);
