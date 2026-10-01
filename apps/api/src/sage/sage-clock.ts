import { SAGE_SERVER_TIME_ZONE } from "./sage.constants";

type WallClock = [
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
];

const wallClockFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: SAGE_SERVER_TIME_ZONE,
	hourCycle: "h23",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

const SAGE_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

function wallClockOf(instant: Date): WallClock {
	const parts = new Map<string, number>();
	for (const part of wallClockFormat.formatToParts(instant)) {
		if (part.type !== "literal") parts.set(part.type, Number(part.value));
	}
	const get = (type: string) => parts.get(type) ?? 0;
	return [
		get("year"),
		get("month"),
		get("day"),
		get("hour"),
		get("minute"),
		get("second"),
	];
}

function wallClockAsUtc([
	year,
	month,
	day,
	hour,
	minute,
	second,
]: WallClock): number {
	return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** An instant as a Sage datetime string, e.g. `2026-07-30T16:50:58`. */
export function toSageClock(instant: Date): string {
	const [year, month, day, hour, minute, second] = wallClockOf(instant);
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${year}-${pad(month)}-${pad(day)}` +
		`T${pad(hour)}:${pad(minute)}:${pad(second)}`
	);
}

/** A Sage datetime string as the real instant it names, or null. */
export function fromSageClock(value: string | null | undefined): Date | null {
	const match = value?.trim().match(SAGE_CLOCK_PATTERN);
	if (!match) return null;
	const wall = match.slice(1, 7).map(Number) as WallClock;
	const target = wallClockAsUtc(wall);
	// Two passes settle the zone offset across a DST change.
	let instant = target;
	for (let pass = 0; pass < 2; pass += 1) {
		const offset = wallClockAsUtc(wallClockOf(new Date(instant))) - instant;
		instant = target - offset;
	}
	return new Date(instant);
}
