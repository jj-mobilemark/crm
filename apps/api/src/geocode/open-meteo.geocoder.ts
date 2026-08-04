import { buildGeocodeQuery } from "./place-key";
import type { GeocodeParts, GeocodeResult } from "./photon.geocoder";

/**
 * Open-Meteo geocoding (GeoNames-backed). Free, no API key, suitable for
 * bulk city/state lookups. Prefer over Nominatim when rate-limited.
 *
 * Docs: https://open-meteo.com/en/docs/geocoding-api
 */
export class OpenMeteoGeocoder {
	private chain: Promise<void> = Promise.resolve();

	constructor(
		private readonly baseUrl = "https://geocoding-api.open-meteo.com/v1/search",
		private readonly minIntervalMs = 50,
	) {}

	async geocode(parts: GeocodeParts): Promise<GeocodeResult> {
		const query = buildGeocodeQuery(
			parts.city,
			parts.stateCode,
			parts.country,
			parts.countryCode,
		);
		if (!query) return { ok: false, reason: "empty" };

		await this.throttle();

		const url = new URL(this.baseUrl);
		url.searchParams.set("name", query);
		url.searchParams.set("count", "5");
		url.searchParams.set("language", "en");
		url.searchParams.set("format", "json");
		if (parts.countryCode && parts.countryCode.length === 2) {
			url.searchParams.set("countryCode", parts.countryCode.toUpperCase());
		}

		try {
			const response = await fetch(url);
			if (!response.ok) {
				return {
					ok: false,
					reason: "error",
					detail: `HTTP ${response.status}`,
					retryable: response.status === 429 || response.status >= 500,
				};
			}
			const body = (await response.json()) as {
				results?: Array<{
					name?: string;
					latitude?: number;
					longitude?: number;
					country_code?: string;
					admin1?: string;
					country?: string;
				}>;
			};
			const rows = body.results ?? [];
			if (rows.length === 0) {
				return { ok: false, reason: "not_found" };
			}

			const wantCountry = parts.countryCode?.toUpperCase() ?? null;
			const pooled = wantCountry
				? rows.filter((row) => row.country_code?.toUpperCase() === wantCountry)
				: rows;
			const hit = (pooled.length > 0 ? pooled : rows)[0];

			if (
				hit?.latitude == null ||
				hit.longitude == null ||
				!Number.isFinite(hit.latitude) ||
				!Number.isFinite(hit.longitude)
			) {
				return { ok: false, reason: "not_found" };
			}

			const rawLabel = [hit.name, hit.admin1, hit.country]
				.filter(Boolean)
				.join(", ");
			return {
				ok: true,
				latitude: hit.latitude,
				longitude: hit.longitude,
				rawLabel: rawLabel || null,
			};
		} catch (error) {
			return {
				ok: false,
				reason: "error",
				detail: error instanceof Error ? error.message : String(error),
				retryable: true,
			};
		}
	}

	private throttle(): Promise<void> {
		const run = this.chain.then(async () => {
			await Bun.sleep(this.minIntervalMs);
		});
		this.chain = run.catch(() => undefined);
		return run;
	}
}
