import { buildGeocodeQuery } from "./place-key";

export type GeocodeResult =
	| {
			ok: true;
			latitude: number;
			longitude: number;
			rawLabel: string | null;
	  }
	| { ok: false; reason: "empty" | "not_found" | "error"; detail?: string };

export type GeocodeParts = {
	city: string | null;
	stateCode: string | null;
	country: string | null;
	countryCode: string | null;
};

/**
 * Komoot Photon (OSM). Public instance — keep concurrency modest (≤8).
 * Much faster than Nominatim's 1 req/s for city-level re-geocodes.
 */
export class PhotonGeocoder {
	constructor(
		private readonly userAgent = "MM-CRM/1.0 (internal; geocode-companies)",
		private readonly baseUrl = "https://photon.komoot.io/api/",
	) {}

	async geocode(parts: GeocodeParts): Promise<GeocodeResult> {
		const query = buildGeocodeQuery(
			parts.city,
			parts.stateCode,
			parts.country,
			parts.countryCode,
		);
		if (!query) return { ok: false, reason: "empty" };

		const url = new URL(this.baseUrl);
		url.searchParams.set("q", query);
		url.searchParams.set("limit", "1");

		try {
			const response = await fetch(url, {
				headers: {
					Accept: "application/json",
					"User-Agent": this.userAgent,
				},
			});
			if (!response.ok) {
				return {
					ok: false,
					reason: "error",
					detail: `HTTP ${response.status}`,
				};
			}
			const body = (await response.json()) as {
				features?: Array<{
					geometry?: { coordinates?: [number, number] };
					properties?: {
						name?: string;
						city?: string;
						state?: string;
						country?: string;
					};
				}>;
			};
			const feature = body.features?.[0];
			const coords = feature?.geometry?.coordinates;
			if (!coords || coords.length < 2) {
				return { ok: false, reason: "not_found" };
			}
			const [longitude, latitude] = coords;
			if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
				return { ok: false, reason: "not_found" };
			}
			const props = feature?.properties;
			const rawLabel = [props?.name ?? props?.city, props?.state, props?.country]
				.filter(Boolean)
				.join(", ");
			return {
				ok: true,
				latitude,
				longitude,
				rawLabel: rawLabel || null,
			};
		} catch (error) {
			return {
				ok: false,
				reason: "error",
				detail: error instanceof Error ? error.message : String(error),
			};
		}
	}
}

/** Run async work over items with a fixed concurrency cap. */
export async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const runners = Array.from(
		{ length: Math.max(1, Math.min(concurrency, items.length || 1)) },
		async () => {
			while (true) {
				const index = next;
				next += 1;
				if (index >= items.length) return;
				results[index] = await worker(items[index]!, index);
			}
		},
	);
	await Promise.all(runners);
	return results;
}
