import { cn } from "@crm/ui/lib/utils";
import type * as React from "react";

type TrendDirection = "up" | "down" | "neutral";

type StatDelta = {
	/** Pre-formatted change, e.g. "+12%" or "+3". */
	value: string;
	/** Drives the color + arrow. Defaults to inferring from a leading sign. */
	direction?: TrendDirection;
	/** Trailing context, e.g. "vs. last month". */
	label?: string;
};

const TREND_COLOR: Record<TrendDirection, string> = {
	up: "text-success",
	down: "text-destructive",
	neutral: "text-muted-foreground",
};

const TREND_GLYPH: Record<TrendDirection, string> = {
	up: "↑",
	down: "↓",
	neutral: "→",
};

function inferDirection(value: string): TrendDirection {
	if (value.trim().startsWith("-")) return "down";
	if (value.trim().startsWith("+")) return "up";
	return "neutral";
}

function StatDeltaText({
	delta,
	className,
}: {
	delta: StatDelta;
	className?: string;
}) {
	const direction = delta.direction ?? inferDirection(delta.value);
	return (
		<span className={cn("inline-flex items-baseline gap-1.5", className)}>
			<span
				className={cn(
					"inline-flex items-baseline gap-0.5 font-medium text-xs tabular-nums",
					TREND_COLOR[direction],
				)}
			>
				{direction !== "neutral" ? (
					<span aria-hidden>{TREND_GLYPH[direction]}</span>
				) : null}
				{delta.value}
			</span>
			{delta.label ? (
				<span className="text-muted-foreground text-xs">{delta.label}</span>
			) : null}
		</span>
	);
}

/**
 * Formatted KPI (money, percent text) that plays a short enter motion when the
 * displayed string changes — obvious on date-range flips without inventing a
 * decimal counter.
 */
function StatTick({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return <span className={cn("stat-tick", className)}>{children}</span>;
}

/**
 * Integer KPI that eases between values via a typed CSS custom property
 * (`@property --stat-num`) and `counter()` — no JS tween, respects
 * `prefers-reduced-motion`. See https://css-tricks.com/animating-number-counters/
 *
 * Solid digits stay as a fallback (reduced motion / older engines); when motion
 * is allowed the counter paints via `::after` instead.
 */
function StatCount({
	value,
	className,
}: {
	value: number;
	className?: string;
}) {
	const safe = Number.isFinite(value) ? Math.round(Math.max(value, 0)) : 0;
	return (
		<span
			className={cn("stat-count tabular-nums", className)}
			style={{ "--stat-num": safe } as React.CSSProperties}
		>
			<span className="stat-count-solid">{safe}</span>
		</span>
	);
}

/**
 * A single KPI — label, headline value, optional trend delta, and an optional
 * slot (`children`) for a sparkline. Intentionally borderless: drop several into
 * a {@link StatGroup} so they read as one divider-separated strip rather than a
 * row of competing boxes. Per the dashboard guidelines, KPIs carry no icons.
 *
 * `tone="static"` soft-mutes the cell for metrics that ignore the overview date
 * range (open pipeline, stuck, due-this-month). `animate` eases integers via
 * {@link StatCount} or ticks formatted strings via {@link StatTick}.
 */
function StatCard({
	label,
	value,
	delta,
	description,
	tone = "default",
	animate = false,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"div">, "title"> & {
	label?: React.ReactNode;
	value: React.ReactNode;
	delta?: StatDelta;
	description?: React.ReactNode;
	tone?: "default" | "static";
	animate?: boolean;
}) {
	const rendered =
		animate && typeof value === "number" ? (
			<StatCount value={value} />
		) : animate ? (
			<StatTick key={String(value)}>{value}</StatTick>
		) : (
			value
		);

	return (
		<div
			data-slot="stat-card"
			data-tone={tone}
			title={
				tone === "static"
					? "Does not change with the date range"
					: undefined
			}
			className={cn(
				"flex flex-col gap-2.5 p-4 md:p-6",
				tone === "static" && "bg-muted/45",
				className,
			)}
			{...props}
		>
			{label != null ? (
				<span className="truncate text-sm font-medium text-muted-foreground">
					{label}
				</span>
			) : null}
			<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
				<span className="font-medium text-3xl tracking-tight tabular-nums">
					{rendered}
				</span>
				{delta ? <StatDeltaText delta={delta} /> : null}
			</div>
			{description ? (
				<p className="text-pretty text-muted-foreground text-xs/relaxed">
					{description}
				</p>
			) : null}
			{children}
		</div>
	);
}

export type { StatDelta, TrendDirection };
export { StatCard, StatCount, StatDeltaText, StatTick };
