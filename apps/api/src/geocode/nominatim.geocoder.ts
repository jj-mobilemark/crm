import { buildGeocodeQuery } from "./place-key";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
/** Nominatim usage policy: max 1 request per second. */
const MIN_INTERVAL_MS = 1100;

export type NominatimResult =
	| {
			ok: true;
			latitude: number;
			longitude: number;
			rawLabel: string | null;
	  }
	| { ok: false; reason: "empty" | "not_found" | "error"; detail?: string };

/**
 * Thin Nominatim client with an in-process rate limit.
 *
 * Identify the app in the User-Agent — required by the usage policy.
 */
export class NominatimGeocoder {
	private lastRequestAt = 0;

	constructor(
		private readonly userAgent = "MM-CRM/1.0 (internal; geocode-companies)",
		private readonly baseUrl = NOMINATIM_URL,
	) {}

	async geocode(parts: {
		city: string | null;
		stateCode: string | null;
		country: string | null;
		countryCode: string | null;
	}): Promise<NominatimResult> {
		const query = buildGeocodeQuery(
			parts.city,
			parts.stateCode,
			parts.country,
			parts.countryCode,
		);
		if (!query) return { ok: false, reason: "empty" };

		await this.throttle();

		const url = new URL(this.baseUrl);
		url.searchParams.set("q", query);
		url.searchParams.set("format", "json");
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
			const rows = (await response.json()) as Array<{
				lat?: string;
				lon?: string;
				display_name?: string;
			}>;
			const hit = rows[0];
			if (!hit?.lat || !hit?.lon) {
				return { ok: false, reason: "not_found" };
			}
			const latitude = Number(hit.lat);
			const longitude = Number(hit.lon);
			if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
				return { ok: false, reason: "not_found" };
			}
			return {
				ok: true,
				latitude,
				longitude,
				rawLabel: hit.display_name ?? null,
			};
		} catch (error) {
			return {
				ok: false,
				reason: "error",
				detail: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async throttle(): Promise<void> {
		const elapsed = Date.now() - this.lastRequestAt;
		if (elapsed < MIN_INTERVAL_MS) {
			await Bun.sleep(MIN_INTERVAL_MS - elapsed);
		}
		this.lastRequestAt = Date.now();
	}
}
