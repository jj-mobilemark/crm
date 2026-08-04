import type { Db } from "@crm/db";
import {
	loadTripPlan,
	searchTripCandidates,
	TripActivityMode,
} from "@crm/db";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { OpenMeteoGeocoder } from "../geocode/open-meteo.geocoder";
import { NominatimGeocoder } from "../geocode/nominatim.geocoder";
import { buildPlaceKey } from "../geocode/place-key";
import type { GeocodeParts, GeocodeResult } from "../geocode/photon.geocoder";
import type {
	TripPlanCreateInput,
	TripPlanUpdateInput,
} from "./trip-plans.contracts";

/**
 * Persisted Trip Planner briefs. Geocodes the hub on create/update.
 * Candidate ranking lives in `@crm/db` — Nest only owns CRUD + hub resolve.
 */

const openMeteo = new OpenMeteoGeocoder();
const nominatim = new NominatimGeocoder();

async function resolveHub(parts: GeocodeParts): Promise<GeocodeResult> {
	const primary = await openMeteo.geocode(parts);
	if (primary.ok || primary.retryable) return primary;
	return nominatim.geocode(parts);
}

@Injectable()
export class TripPlansService {
	private readonly logger = new Logger(TripPlansService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async list(userId: string) {
		const rows = await this.db.tripPlan.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			take: 50,
		});
		return rows.map((row) => ({
			id: row.id,
			hubCity: row.hubCity,
			hubStateCode: row.hubStateCode,
			dayCount: row.dayCount,
			radiusMiles: row.radiusMiles,
			activityMode: row.activityMode,
			activityYears: row.activityYears,
			status: row.status,
			mustVisitCount: row.mustVisitCompanyIds.length,
			hasItinerary: row.itinerary != null,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		}));
	}

	async get(id: string, userId: string) {
		const plan = await loadTripPlan(this.db, id);
		if (!plan || plan.userId !== userId) {
			throw new NotFoundException(`No trip plan with id ${id}.`);
		}
		return plan;
	}

	async create(input: TripPlanCreateInput, userId: string) {
		const hub = await this.geocodeHub(input.hubCity, input.hubStateCode);
		const row = await this.db.tripPlan.create({
			data: {
				userId,
				hubCity: input.hubCity.trim(),
				hubStateCode: input.hubStateCode,
				hubLatitude: hub.latitude,
				hubLongitude: hub.longitude,
				hubGeocodePlaceKey: hub.placeKey,
				dayCount: input.dayCount,
				radiusMiles: input.radiusMiles,
				activityMode: input.activityMode as TripActivityMode,
				activityYears: input.activityYears,
				mustVisitCompanyIds: input.mustVisitCompanyIds,
				maxVisitsPerDay: input.maxVisitsPerDay ?? null,
				notes: input.notes ?? null,
			},
		});
		this.logger.log({ message: "Trip plan created", tripPlanId: row.id });
		return this.get(row.id, userId);
	}

	async update(input: TripPlanUpdateInput, userId: string) {
		const existing = await this.db.tripPlan.findUnique({
			where: { id: input.id },
		});
		if (!existing || existing.userId !== userId) {
			throw new NotFoundException(`No trip plan with id ${input.id}.`);
		}

		const hubCity = input.hubCity?.trim() ?? existing.hubCity;
		const hubStateCode = input.hubStateCode ?? existing.hubStateCode;
		const hubChanged =
			hubCity !== existing.hubCity || hubStateCode !== existing.hubStateCode;

		let hubLat = existing.hubLatitude;
		let hubLng = existing.hubLongitude;
		let placeKey = existing.hubGeocodePlaceKey;

		if (hubChanged) {
			const hub = await this.geocodeHub(hubCity, hubStateCode);
			hubLat = hub.latitude;
			hubLng = hub.longitude;
			placeKey = hub.placeKey;
		}

		await this.db.tripPlan.update({
			where: { id: input.id },
			data: {
				hubCity,
				hubStateCode,
				hubLatitude: hubLat,
				hubLongitude: hubLng,
				hubGeocodePlaceKey: placeKey,
				...(input.dayCount !== undefined ? { dayCount: input.dayCount } : {}),
				...(input.radiusMiles !== undefined
					? { radiusMiles: input.radiusMiles }
					: {}),
				...(input.activityMode !== undefined
					? { activityMode: input.activityMode as TripActivityMode }
					: {}),
				...(input.activityYears !== undefined
					? { activityYears: input.activityYears }
					: {}),
				...(input.mustVisitCompanyIds !== undefined
					? { mustVisitCompanyIds: input.mustVisitCompanyIds }
					: {}),
				...(input.maxVisitsPerDay !== undefined
					? { maxVisitsPerDay: input.maxVisitsPerDay }
					: {}),
				...(input.notes !== undefined ? { notes: input.notes } : {}),
			},
		});

		return this.get(input.id, userId);
	}

	async remove(id: string, userId: string) {
		const existing = await this.db.tripPlan.findUnique({
			where: { id },
			select: { id: true, userId: true },
		});
		if (!existing || existing.userId !== userId) {
			throw new NotFoundException(`No trip plan with id ${id}.`);
		}
		await this.db.tripPlan.delete({ where: { id } });
		return { id };
	}

	async candidates(id: string, userId: string, limit?: number) {
		const plan = await this.get(id, userId);
		return searchTripCandidates(this.db, {
			hubLatitude: plan.hubLatitude,
			hubLongitude: plan.hubLongitude,
			radiusMiles: plan.radiusMiles,
			activityMode: plan.activityMode,
			activityYears: plan.activityYears,
			mustVisitCompanyIds: plan.mustVisitCompanyIds,
			limit,
		});
	}

	private async geocodeHub(city: string, stateCode: string) {
		const parts: GeocodeParts = {
			city,
			stateCode,
			country: "United States",
			countryCode: "US",
		};
		const placeKey = buildPlaceKey(city, stateCode, "US");

		if (placeKey) {
			const cached = await this.db.geocodeCache.findUnique({
				where: { placeKey },
			});
			if (
				cached?.status === "ok" &&
				cached.latitude != null &&
				cached.longitude != null
			) {
				return {
					latitude: cached.latitude,
					longitude: cached.longitude,
					placeKey,
				};
			}
		}

		const result = await resolveHub(parts);
		if (!result.ok) {
			throw new BadRequestException(
				`Could not geocode hub "${city}, ${stateCode}". Check the city and state.`,
			);
		}

		if (placeKey) {
			await this.db.geocodeCache.upsert({
				where: { placeKey },
				create: {
					placeKey,
					latitude: result.latitude,
					longitude: result.longitude,
					status: "ok",
					rawLabel: result.rawLabel,
				},
				update: {
					latitude: result.latitude,
					longitude: result.longitude,
					status: "ok",
					rawLabel: result.rawLabel,
					queriedAt: new Date(),
				},
			});
		}

		return {
			latitude: result.latitude,
			longitude: result.longitude,
			placeKey,
		};
	}
}
