"use client";

import { Button } from "@crm/ui/components/button";
import { DatePicker } from "@crm/ui/components/date-picker";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@crm/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { useQueryStates } from "nuqs";
import { useRef, useState } from "react";
import {
	OVERVIEW_RANGES,
	type OverviewRange,
	overviewParsers,
} from "./overview-search-params";

const LABELS: Record<OverviewRange, string> = {
	today: "Today",
	this_week: "This week",
	this_month: "This month",
	this_year: "Since the 1st of the year",
	past_30: "Past 30 days",
	custom: "Custom",
};

function isRange(value: string): value is OverviewRange {
	return (OVERVIEW_RANGES as readonly string[]).includes(value);
}

function todayDay(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function monthStartDay(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	return `${y}-${m}-01`;
}

/**
 * Closed-won / win-rate window on the overview.
 *
 * Lives in the URL next to `scope` so a manager can send "team, past 30 days"
 * as a link. Open pipeline and the forecast tables ignore it.
 */
export function OverviewRangeControl() {
	const [params, setParams] = useQueryStates(overviewParsers);
	const [customOpen, setCustomOpen] = useState(false);
	const [draftFrom, setDraftFrom] = useState(
		() => params.from ?? monthStartDay(),
	);
	const [draftTo, setDraftTo] = useState(() => params.to ?? todayDay());
	// Select dismisses with a pointer-up that lands "outside" the popover we
	// just opened — Radix then closes it. Ignore those closes briefly.
	const ignoreCloseUntil = useRef(0);
	const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const openCustomPanel = (from: string, to: string) => {
		setDraftFrom(from);
		setDraftTo(to);
		if (openTimer.current) clearTimeout(openTimer.current);
		ignoreCloseUntil.current = Date.now() + 200;
		// After the Select portal finishes tearing down; opening in the same
		// tick loses to the dismiss pointer-up.
		openTimer.current = setTimeout(() => setCustomOpen(true), 10);
	};

	const applyPreset = (next: OverviewRange) => {
		if (next === "custom") {
			const from = params.from ?? monthStartDay();
			const to = params.to ?? todayDay();
			openCustomPanel(from, to);
			return;
		}
		if (openTimer.current) clearTimeout(openTimer.current);
		setCustomOpen(false);
		void setParams({ range: next, from: null, to: null });
	};

	const applyCustom = () => {
		if (!draftFrom || !draftTo || draftFrom > draftTo) return;
		void setParams({ range: "custom", from: draftFrom, to: draftTo });
		setCustomOpen(false);
	};

	const triggerLabel =
		params.range === "custom" && params.from && params.to
			? `${params.from} → ${params.to}`
			: LABELS[params.range];

	return (
		<Popover
			open={customOpen}
			onOpenChange={(open) => {
				if (!open && Date.now() < ignoreCloseUntil.current) return;
				setCustomOpen(open);
			}}
		>
			<PopoverAnchor asChild>
				<div>
					<Select
						value={params.range}
						onValueChange={(next) => {
							if (isRange(next)) applyPreset(next);
						}}
					>
						<SelectTrigger
							size="sm"
							aria-label="Date range for closed won and win rate"
						>
							<SelectValue>{triggerLabel}</SelectValue>
						</SelectTrigger>
						<SelectContent align="end">
							{OVERVIEW_RANGES.map((value) => (
								<SelectItem key={value} value={value}>
									{LABELS[value]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="end"
				// Nested DatePicker calendars portal outside this content; do not
				// treat those clicks as "dismiss the range panel".
				onInteractOutside={(event) => {
					const target = event.target as HTMLElement | null;
					if (target?.closest('[data-slot="popover-content"]')) {
						event.preventDefault();
					}
				}}
			>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">From</span>
						<DatePicker value={draftFrom} onChange={setDraftFrom} />
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">To</span>
						<DatePicker value={draftTo} onChange={setDraftTo} />
					</div>
					<Button
						size="sm"
						disabled={!draftFrom || !draftTo || draftFrom > draftTo}
						onClick={applyCustom}
					>
						Apply
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
