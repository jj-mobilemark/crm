import {
	DealStage,
	TripActivityMode,
	type PrismaClient,
} from "./generated/prisma/client";

/**
 * Shared Trip Planner loaders — Nest tRPC and agent tools call the same
 * helpers so candidate lists and itinerary shapes cannot drift.
 *
 * Mechanical only: distance + deal windows + open-pipeline size + ownership
 * band (mine / unassigned / other). No judgements beyond that ranking.
 */

export const TRIP_CANDIDATE_LIMIT = 60;

const OPEN_DEAL_STAGES = [
	DealStage.DEMO_BOOKED,
	DealStage.QUALIFIED_TO_BUY,
	DealStage.DECISION_MAKER_BOUGHT_IN,
	DealStage.CONTRACT_SENT,
	DealStage.IN_PURCHASING,
] as const;

const OPEN_DEAL_STAGE_LIST = [...OPEN_DEAL_STAGES];

/** Earth radius in miles (mean). */
const EARTH_RADIUS_MI = 3958.8;

export type TripOwnership = "mine" | "unassigned" | "other";

/** Sort key: mine first, then unassigned, then other-owned. */
function ownershipRank(ownership: TripOwnership): number {
	if (ownership === "mine") return 0;
	if (ownership === "unassigned") return 1;
	return 2;
}

/** Classify a company relative to the trip planner. */
export function resolveTripOwnership(
	ownerId: string | null | undefined,
	plannerUserId: string,
): TripOwnership {
	if (ownerId == null) return "unassigned";
	if (ownerId === plannerUserId) return "mine";
	return "other";
}

export type TripPlanSummary = {
	id: string;
	userId: string;
	hubCity: string;
	hubStateCode: string;
	hubLatitude: number;
	hubLongitude: number;
	hubGeocodePlaceKey: string | null;
	dayCount: number;
	radiusMiles: number;
	activityMode: TripActivityMode;
	activityYears: number;
	mustVisitCompanyIds: string[];
	maxVisitsPerDay: number | null;
	notes: string | null;
	itinerary: TripItinerary | null;
	status: "DRAFT" | "PLANNED";
	createdAt: string;
	updatedAt: string;
};

export type TripItineraryStop = {
	companyId: string;
	companyName: string;
	city: string | null;
	stateCode: string | null;
	streetAddress: string | null;
	sage100CustomerNo: string | null;
	contactCount: number;
	milesFromHub: number | null;
	notes: string | null;
};

export type TripItineraryDay = {
	day: number;
	label: string | null;
	stops: TripItineraryStop[];
};

export type TripItinerary = {
	summary: string | null;
	days: TripItineraryDay[];
};

export type TripCandidate = {
	id: string;
	name: string;
	city: string | null;
	stateCode: string | null;
	streetAddress: string | null;
	sage100CustomerNo: string | null;
	contactCount: number;
	milesFromHub: number;
	outsideRadius: boolean;
	mustVisit: boolean;
	/** Relative to the trip planner (`TripPlan.userId`). */
	ownership: TripOwnership;
	/** Account owner's display name when `ownership` is `other`. */
	ownerName: string | null;
	dealCountInWindow: number;
	/** Count of deals still in an open CRM stage (not won/lost/unqualified). */
	openDealCount: number;
	/** Sum of open-deal `amount` (deal size). Null when there are no open deals. */
	openPipelineAmount: number | null;
	yearsSinceLastDeal: number | null;
	lastDealAt: string | null;
};

export type SearchTripCandidatesInput = {
	hubLatitude: number;
	hubLongitude: number;
	radiusMiles: number;
	activityMode: TripActivityMode;
	activityYears: number;
	mustVisitCompanyIds: string[];
	/** Trip plan owner — used to mark mine / unassigned / other. */
	plannerUserId: string;
	/** Override default cap (agent + UI). */
	limit?: number;
};

function haversineMiles(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bounding-box pad so the SQL prefilter stays loose around the circle. */
function boundingBox(
	lat: number,
	lng: number,
	radiusMiles: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
	const latDelta = radiusMiles / 69.0;
	const lngDelta =
		radiusMiles / (Math.cos((lat * Math.PI) / 180) * 69.172 || 69.172);
	return {
		minLat: lat - latDelta,
		maxLat: lat + latDelta,
		minLng: lng - lngDelta,
		maxLng: lng + lngDelta,
	};
}

function parseItinerary(raw: unknown): TripItinerary | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as { summary?: unknown; days?: unknown };
	if (!Array.isArray(obj.days)) return null;
	return {
		summary: typeof obj.summary === "string" ? obj.summary : null,
		days: obj.days.map((day, index) => {
			const d = day as {
				day?: unknown;
				label?: unknown;
				stops?: unknown;
			};
			const stops = Array.isArray(d.stops) ? d.stops : [];
			return {
				day: typeof d.day === "number" ? d.day : index + 1,
				label: typeof d.label === "string" ? d.label : null,
				stops: stops.map((stop) => {
					const s = stop as Record<string, unknown>;
					return {
						companyId: String(s.companyId ?? ""),
						companyName: String(s.companyName ?? ""),
						city: typeof s.city === "string" ? s.city : null,
						stateCode: typeof s.stateCode === "string" ? s.stateCode : null,
						streetAddress:
							typeof s.streetAddress === "string" ? s.streetAddress : null,
						sage100CustomerNo:
							typeof s.sage100CustomerNo === "string"
								? s.sage100CustomerNo
								: null,
						contactCount:
							typeof s.contactCount === "number" ? s.contactCount : 0,
						milesFromHub:
							typeof s.milesFromHub === "number" ? s.milesFromHub : null,
						notes: typeof s.notes === "string" ? s.notes : null,
					};
				}),
			};
		}),
	};
}

export async function loadTripPlan(
	db: PrismaClient,
	tripPlanId: string,
): Promise<TripPlanSummary | null> {
	const row = await db.tripPlan.findUnique({ where: { id: tripPlanId } });
	if (!row) return null;
	return {
		id: row.id,
		userId: row.userId,
		hubCity: row.hubCity,
		hubStateCode: row.hubStateCode,
		hubLatitude: row.hubLatitude,
		hubLongitude: row.hubLongitude,
		hubGeocodePlaceKey: row.hubGeocodePlaceKey,
		dayCount: row.dayCount,
		radiusMiles: row.radiusMiles,
		activityMode: row.activityMode,
		activityYears: row.activityYears,
		mustVisitCompanyIds: row.mustVisitCompanyIds,
		maxVisitsPerDay: row.maxVisitsPerDay,
		notes: row.notes,
		itinerary: parseItinerary(row.itinerary),
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function searchTripCandidates(
	db: PrismaClient,
	input: SearchTripCandidatesInput,
): Promise<TripCandidate[]> {
	const limit = input.limit ?? TRIP_CANDIDATE_LIMIT;
	const mustSet = new Set(input.mustVisitCompanyIds);
	const cutoff = new Date();
	cutoff.setFullYear(cutoff.getFullYear() - input.activityYears);

	// Pad the box so must-visits just outside the circle still come back when
	// we fetch by id; the in-radius pass uses the real circle.
	const boxPad = Math.max(input.radiusMiles, 50) * 1.15;
	const box = boundingBox(input.hubLatitude, input.hubLongitude, boxPad);

	const dealInWindow = {
		OR: [{ createdAt: { gte: cutoff } }, { closedAt: { gte: cutoff } }],
	};

	// ACTIVE includes anyone with recent deal activity OR a still-open deal
	// (even if that deal was opened before the look-back window). Open deals
	// are the main reason to swing by a neighbour on a trip.
	const activityFilter =
		input.activityMode === TripActivityMode.ACTIVE
			? {
					OR: [
						{ deals: { some: dealInWindow } },
						{ deals: { some: { stage: { in: OPEN_DEAL_STAGE_LIST } } } },
					],
				}
			: { NOT: { deals: { some: dealInWindow } } };

	const inBox = await db.company.findMany({
		where: {
			AND: [
				{ latitude: { not: null, gte: box.minLat, lte: box.maxLat } },
				{ longitude: { not: null, gte: box.minLng, lte: box.maxLng } },
				activityFilter,
			],
		},
		select: {
			id: true,
			name: true,
			city: true,
			stateCode: true,
			streetAddress: true,
			sage100CustomerNo: true,
			latitude: true,
			longitude: true,
			ownerId: true,
			owner: { select: { name: true } },
			_count: { select: { contacts: true } },
			deals: {
				select: {
					amount: true,
					stage: true,
					createdAt: true,
					closedAt: true,
				},
			},
		},
		take: 2000,
	});

	const missingMustIds = [...mustSet].filter(
		(id) => !inBox.some((row) => row.id === id),
	);
	const mustExtra =
		missingMustIds.length === 0
			? []
			: await db.company.findMany({
					where: { id: { in: missingMustIds } },
					select: {
						id: true,
						name: true,
						city: true,
						stateCode: true,
						streetAddress: true,
						sage100CustomerNo: true,
						latitude: true,
						longitude: true,
						ownerId: true,
						owner: { select: { name: true } },
						_count: { select: { contacts: true } },
						deals: {
							select: {
								amount: true,
								stage: true,
								createdAt: true,
								closedAt: true,
							},
						},
					},
				});

	const byId = new Map<string, (typeof inBox)[number]>();
	for (const row of [...inBox, ...mustExtra]) {
		byId.set(row.id, row);
	}

	const candidates: TripCandidate[] = [];

	for (const row of byId.values()) {
		const lat = row.latitude;
		const lng = row.longitude;
		const mustVisit = mustSet.has(row.id);
		const miles =
			lat != null && lng != null
				? haversineMiles(input.hubLatitude, input.hubLongitude, lat, lng)
				: Number.POSITIVE_INFINITY;
		const outsideRadius =
			!Number.isFinite(miles) || miles > input.radiusMiles + 0.01;

		if (!mustVisit && outsideRadius) continue;

		let dealCountInWindow = 0;
		let openDealCount = 0;
		let openPipelineAmount = 0;
		let lastDealMs: number | null = null;

		for (const deal of row.deals) {
			const createdMs = deal.createdAt.getTime();
			const closedMs = deal.closedAt?.getTime() ?? null;
			const latest = Math.max(createdMs, closedMs ?? 0);
			if (lastDealMs === null || latest > lastDealMs) lastDealMs = latest;

			const inWindow =
				deal.createdAt >= cutoff ||
				(deal.closedAt != null && deal.closedAt >= cutoff);
			if (inWindow) dealCountInWindow += 1;

			if ((OPEN_DEAL_STAGES as readonly string[]).includes(deal.stage)) {
				openDealCount += 1;
				if (deal.amount != null) {
					openPipelineAmount += Number(deal.amount);
				}
			}
		}

		const yearsSinceLastDeal =
			lastDealMs == null
				? null
				: (Date.now() - lastDealMs) / (365.25 * 24 * 60 * 60 * 1000);

		const ownership = resolveTripOwnership(row.ownerId, input.plannerUserId);

		candidates.push({
			id: row.id,
			name: row.name,
			city: row.city,
			stateCode: row.stateCode,
			streetAddress: row.streetAddress,
			sage100CustomerNo: row.sage100CustomerNo,
			contactCount: row._count.contacts,
			milesFromHub: Number.isFinite(miles) ? Math.round(miles * 10) / 10 : -1,
			outsideRadius,
			mustVisit,
			ownership,
			ownerName: ownership === "other" ? (row.owner?.name ?? null) : null,
			dealCountInWindow,
			openDealCount,
			openPipelineAmount:
				openDealCount > 0
					? Math.round(openPipelineAmount * 100) / 100
					: null,
			yearsSinceLastDeal:
				yearsSinceLastDeal == null
					? null
					: Math.round(yearsSinceLastDeal * 10) / 10,
			lastDealAt: lastDealMs == null ? null : new Date(lastDealMs).toISOString(),
		});
	}

	// Must-visits first, then ownership band (mine → unassigned → other), then
	// open-deal accounts by deal size, then activity / salvage, then nearer.
	candidates.sort((a, b) => {
		if (a.mustVisit !== b.mustVisit) return a.mustVisit ? -1 : 1;
		const ownCmp = ownershipRank(a.ownership) - ownershipRank(b.ownership);
		if (ownCmp !== 0) return ownCmp;
		const aOpen = a.openDealCount > 0;
		const bOpen = b.openDealCount > 0;
		if (aOpen !== bOpen) return aOpen ? -1 : 1;
		const aAmt = a.openPipelineAmount ?? 0;
		const bAmt = b.openPipelineAmount ?? 0;
		if (aAmt !== bAmt) return bAmt - aAmt;
		if (a.openDealCount !== b.openDealCount) {
			return b.openDealCount - a.openDealCount;
		}
		if (input.activityMode === TripActivityMode.ACTIVE) {
			if (a.dealCountInWindow !== b.dealCountInWindow) {
				return b.dealCountInWindow - a.dealCountInWindow;
			}
		} else {
			const aYears = a.yearsSinceLastDeal ?? 999;
			const bYears = b.yearsSinceLastDeal ?? 999;
			if (aYears !== bYears) return bYears - aYears;
		}
		return a.milesFromHub - b.milesFromHub;
	});

	return candidates.slice(0, limit);
}

export async function writeTripItinerary(
	db: PrismaClient,
	tripPlanId: string,
	itinerary: TripItinerary,
): Promise<TripPlanSummary | null> {
	const updated = await db.tripPlan.update({
		where: { id: tripPlanId },
		data: {
			itinerary,
			status: "PLANNED",
		},
	});
	return loadTripPlan(db, updated.id);
}
