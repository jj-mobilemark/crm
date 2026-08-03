import type { Db, DealStage, Priority, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/** Fields the overview pulse cares about. */
export const DEAL_CHANGE_FIELDS = [
	"stage",
	"probability",
	"amount",
	"expectedCloseDate",
	"ownerId",
	"priority",
	"sageStage",
] as const;

export type DealChangeField = (typeof DEAL_CHANGE_FIELDS)[number];

export type DealChangeSource = "app" | "sage";

/** Snapshot of tracked deal columns before/after a write. */
export type DealChangeSnapshot = {
	stage: DealStage;
	probability: number | null;
	/** Decimal, number, or Sage mapping string — compared via fixed 2-dp key. */
	amount: Prisma.Decimal | number | string | null;
	expectedCloseDate: Date | null;
	ownerId: string;
	priority: Priority | null;
	sageStage: string | null;
};

export const DEAL_CHANGE_SELECT = {
	stage: true,
	probability: true,
	amount: true,
	expectedCloseDate: true,
	ownerId: true,
	priority: true,
	sageStage: true,
} as const;

/**
 * Append-only deal field diffs for the overview pulse.
 *
 * Callers pass before/after snapshots; we write one row per changed field.
 * Push-echo Sage pulls must not call this (they skip the update path entirely).
 */
@Injectable()
export class DealChangeRecorder {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async recordDiffs(input: {
		dealId: string;
		before: DealChangeSnapshot;
		after: DealChangeSnapshot;
		source: DealChangeSource;
		actorUserId?: string | null;
		at?: Date;
	}): Promise<number> {
		const rows: Prisma.DealFieldChangeCreateManyInput[] = [];
		const at = input.at ?? new Date();

		for (const field of DEAL_CHANGE_FIELDS) {
			const fromValue = serializeField(field, input.before);
			const toValue = serializeField(field, input.after);
			if (fromValue === toValue) continue;
			rows.push({
				dealId: input.dealId,
				field,
				fromValue,
				toValue,
				source: input.source,
				actorUserId: input.actorUserId ?? null,
				createdAt: at,
			});
		}

		if (rows.length === 0) return 0;

		const result = await this.db.dealFieldChange.createMany({ data: rows });
		return result.count;
	}
}

function serializeField(
	field: DealChangeField,
	snap: DealChangeSnapshot,
): string | null {
	switch (field) {
		case "stage":
			return snap.stage;
		case "probability":
			return snap.probability === null ? null : String(snap.probability);
		case "amount":
			return moneyKey(snap.amount);
		case "expectedCloseDate":
			return snap.expectedCloseDate
				? dayKey(snap.expectedCloseDate)
				: null;
		case "ownerId":
			return snap.ownerId;
		case "priority":
			return snap.priority;
		case "sageStage":
			return snap.sageStage;
	}
}

/** Stable money compare — Decimal, number, and Sage strings → fixed 2-dp. */
function moneyKey(
	value: Prisma.Decimal | number | string | null,
): string | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === "number" ? value : Number(value.toString());
	if (!Number.isFinite(n)) return null;
	return n.toFixed(2);
}

function dayKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}
