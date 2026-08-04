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
	CERTAINTY_BY_REP_WINDOWS,
	type CertaintyByRepWindow,
	overviewParsers,
} from "./overview-search-params";

const LABELS: Record<CertaintyByRepWindow, string> = {
	this_month: "This month",
	next_30: "Next 30 days",
	next_3m: "Next 3 months",
	next_6m: "Next 6 months",
	custom: "Custom",
};

function isWindow(value: string): value is CertaintyByRepWindow {
	return (CERTAINTY_BY_REP_WINDOWS as readonly string[]).includes(value);
}

function monthStartDay(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	return `${y}-${m}-01`;
}

function monthEndDay(): string {
	const now = new Date();
	const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
	const y = end.getFullYear();
	const m = String(end.getMonth() + 1).padStart(2, "0");
	const d = String(end.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * Close-date window for the certainty × rep grid.
 *
 * Separate URL keys from the overview closed-won range so managers can look
 * at "this month's closings" without changing win-rate KPIs.
 */
export function CertaintyByRepWindowControl() {
	const [params, setParams] = useQueryStates(overviewParsers);
	const [customOpen, setCustomOpen] = useState(false);
	const [draftFrom, setDraftFrom] = useState(
		() => params.certFrom ?? monthStartDay(),
	);
	const [draftTo, setDraftTo] = useState(
		() => params.certTo ?? monthEndDay(),
	);
	const ignoreCloseUntil = useRef(0);
	const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const openCustomPanel = (from: string, to: string) => {
		setDraftFrom(from);
		setDraftTo(to);
		if (openTimer.current) clearTimeout(openTimer.current);
		ignoreCloseUntil.current = Date.now() + 200;
		openTimer.current = setTimeout(() => setCustomOpen(true), 10);
	};

	const applyPreset = (next: CertaintyByRepWindow) => {
		if (next === "custom") {
			const from = params.certFrom ?? monthStartDay();
			const to = params.certTo ?? monthEndDay();
			openCustomPanel(from, to);
			return;
		}
		if (openTimer.current) clearTimeout(openTimer.current);
		setCustomOpen(false);
		void setParams({ certWindow: next, certFrom: null, certTo: null });
	};

	const applyCustom = () => {
		if (!draftFrom || !draftTo || draftFrom > draftTo) return;
		void setParams({
			certWindow: "custom",
			certFrom: draftFrom,
			certTo: draftTo,
		});
		setCustomOpen(false);
	};

	const triggerLabel =
		params.certWindow === "custom" && params.certFrom && params.certTo
			? `${params.certFrom} → ${params.certTo}`
			: LABELS[params.certWindow];

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
						value={params.certWindow}
						onValueChange={(next) => {
							if (isWindow(next)) applyPreset(next);
						}}
					>
						<SelectTrigger
							size="sm"
							aria-label="Close window for certainty by rep"
						>
							<SelectValue>{triggerLabel}</SelectValue>
						</SelectTrigger>
						<SelectContent align="end">
							{CERTAINTY_BY_REP_WINDOWS.map((value) => (
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
