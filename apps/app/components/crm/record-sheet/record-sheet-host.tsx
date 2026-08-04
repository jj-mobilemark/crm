"use client";

import { useState } from "react";
import { CloseReasonDialog } from "@/components/crm/stage-change";
import { DetailSheet } from "@/components/detail-sheet";
import { CompanySheet } from "./company-sheet";
import { ContactSheet } from "./contact-sheet";
import { DealSheet } from "./deal-sheet";
import { type RecordRef, recordKey, useRecordStack } from "./record-stack";
import { SalesRepSheet } from "./sales-rep-sheet";

/**
 * The one place a company, contact, deal or sales rep is rendered.
 *
 * Mounted in the app shell rather than per page, so opening a contact from a
 * deal on the deals table works the same as opening one from the contacts
 * table — and so no list has to carry a copy of every sheet a row might lead
 * to.
 */
export function RecordSheetHost() {
	const { stack, top, closeAll } = useRecordStack();

	// The record that was last open, kept a beat longer than the URL says.
	// Unmounting the instant `?record=` clears would cut the close animation
	// off halfway and make the sheet vanish rather than slide out.
	const [shown, setShown] = useState<RecordRef | null>(top);
	if (top && (!shown || recordKey(shown) !== recordKey(top))) {
		setShown(top);
	}

	return (
		<>
			{/*
			 * One dialog for every record, out here rather than inside each sheet.
			 * Stepping sideways — a company to one of its deals to somebody on that
			 * deal — then only swaps the contents, and the panel, its backdrop and
			 * the body scroll lock stay exactly where they are.
			 *
			 * A dialog per record would instead be torn out and rebuilt on that
			 * move, because the sheet being unmounted is a different component from
			 * the one taking its place. Radix only animates the `open` prop
			 * changing, so the old panel disappears without sliding out, the new
			 * one replays its slide-in from the right, and the list behind the
			 * translucent backdrop jumps by the width of the scrollbar as the
			 * scroll lock is released and immediately re-applied. That is the
			 * flicker, and it is not the record loading — it happens between two
			 * records already in cache.
			 */}
			<DetailSheet
				open={stack.length > 0}
				onOpenChange={(next) => {
					if (!next) closeAll();
				}}
			>
				{/*
				 * Keyed by record so moving to another one starts fresh: a sheet on
				 * Overview, scrolled to the top, rather than inheriting where you
				 * happened to be in the last one. Inside the dialog, so that reset
				 * costs the contents and not the panel around them.
				 */}
				{shown?.kind === "company" ? (
					<CompanySheet key={recordKey(shown)} companyId={shown.id} />
				) : null}

				{shown?.kind === "contact" ? (
					<ContactSheet key={recordKey(shown)} contactId={shown.id} />
				) : null}

				{shown?.kind === "deal" ? (
					<DealSheet key={recordKey(shown)} dealId={shown.id} />
				) : null}

				{shown?.kind === "user" ? (
					<SalesRepSheet key={recordKey(shown)} userId={shown.id} />
				) : null}
			</DetailSheet>

			{/*
			 * "Why did we lose it?" is asked from a table row, a board card and a
			 * deal sheet. One dialog for all of them, reading which deal from the
			 * URL, beats one per row.
			 */}
			<CloseReasonDialog />
		</>
	);
}
