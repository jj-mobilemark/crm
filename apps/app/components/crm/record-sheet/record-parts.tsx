"use client";

import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Spinner } from "@crm/ui/components/spinner";
import { formatMoney } from "@crm/ui/lib/format";
import type { ReactNode } from "react";
import {
	DetailSheetHeader,
	type DetailSheetTab,
	DetailSheetTabs,
} from "@/components/detail-sheet";
import { useRecordStack } from "./record-stack";

/**
 * The frame every record sheet is poured into.
 *
 * The contents of the panel, not the panel: the one dialog every record is
 * shown in belongs to `RecordSheetHost`, so stepping sideways from a company
 * to one of its deals swaps what is in here without rebuilding the panel
 * around it.
 *
 * The header renders before the record has loaded — a sheet has to have a
 * title from the first frame or the dialog is unlabelled, and a panel that
 * pops into existence a beat after the click reads as a bug rather than as
 * loading.
 */
export function RecordSheetFrame({
	loading,
	error,
	title,
	description,
	note,
	media,
	actions,
	stats,
	tabs,
	tab,
	onTabChange,
}: {
	loading: boolean;
	error: string | null;
	title: string;
	description?: ReactNode;
	note?: ReactNode;
	media?: ReactNode;
	actions?: ReactNode;
	stats?: ReactNode;
	tabs: DetailSheetTab[];
	tab: string;
	onTabChange: (tab: string) => void;
}) {
	// Back and close read from the same stack, so the frame does not need them
	// passed down: Back appears when there is a record underneath, and closing
	// leaves the trail.
	const { stack, close, closeAll } = useRecordStack();

	return (
		<>
			<DetailSheetHeader
				media={media}
				title={title}
				description={description}
				note={note}
				actions={actions}
				onBack={stack.length > 1 ? close : undefined}
				onClose={closeAll}
			/>

			{loading ? (
				<div className="flex min-h-0 flex-1 items-center justify-center">
					<Spinner />
				</div>
			) : error ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
					<p className="font-medium text-sm">This record could not be loaded</p>
					<p className="text-muted-foreground text-xs">{error}</p>
				</div>
			) : (
				<>
					{stats}
					<DetailSheetTabs
						tabs={tabs}
						value={tab}
						onValueChange={onTabChange}
					/>
				</>
			)}
		</>
	);
}

/** Money, or the dash that means nobody has put a number on it yet. */
export function DealAmount({
	amountCents,
	currency,
}: {
	amountCents: number | null;
	currency: string;
}) {
	if (amountCents === null) return <EmptyCellValue />;
	return (
		<span className="tabular-nums">{formatMoney(amountCents, currency)}</span>
	);
}

/**
 * A record's meta line: `attio.com · London · Software`, with the first part
 * optionally a link. Assembled here so a company, a contact and a deal all
 * separate their facts the same way.
 */
export function MetaLine({
	lead,
	parts,
}: {
	lead?: ReactNode;
	parts: (string | null | undefined)[];
}) {
	// Deduplicated, case-insensitively. The parts come from different fields that
	// can legitimately hold the same string — a contact at a company called
	// Architect whose title is "Architect" would otherwise read
	// "Architect · Architect", and render two children under the same key.
	const seen = new Set<string>();
	const rest: string[] = [];

	for (const part of parts) {
		const value = part?.trim();
		if (!value) continue;

		const key = value.toLowerCase();
		if (seen.has(key)) continue;

		seen.add(key);
		rest.push(value);
	}

	return (
		<>
			{lead}
			{rest.map((part, index) => (
				<span key={part}>
					{index === 0 && !lead ? null : " · "}
					{part}
				</span>
			))}
		</>
	);
}

/** The domain, as a link, which is what a domain is. */
export function DomainLink({
	domain,
	website,
}: {
	domain: string | null;
	website: string | null;
}) {
	// Prefer the canonical domain. Website may be a legacy Sage note string —
	// never use it as an href unless it is URL-shaped.
	const websiteHref = websiteHrefOrNull(website);
	const href = domain ? `https://${domain}` : websiteHref;
	const label = domain ?? (websiteHref ? website : null);
	if (!href || !label) return null;

	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			onClick={(event) => event.stopPropagation()}
			className="text-foreground underline-offset-2 hover:underline"
		>
			{label}
		</a>
	);
}

function websiteHrefOrNull(website: string | null): string | null {
	if (!website?.trim()) return null;
	const trimmed = website.trim();
	if (/\s/.test(trimmed)) return null;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/.*)?$/i.test(
		trimmed,
	)) {
		return `https://${trimmed}`;
	}
	return null;
}
