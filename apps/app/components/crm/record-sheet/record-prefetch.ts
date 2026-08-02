"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTRPC } from "@/lib/trpc/client";
import type { RecordRef } from "./record-stack";

/**
 * Warms the record a row would open, on hover.
 *
 * Opening a sheet is otherwise a cold fetch, so the panel arrives with a
 * spinner and a placeholder title and only becomes the record a moment later —
 * which reads as the sheet not having opened at all. A hover is half a second
 * of warning, and it is free: the query client's 30s `staleTime` means moving
 * back over the same row costs nothing.
 *
 * Takes a `RecordRef` so it is the exact twin of `useOpenRecord` at the call
 * site — `prefetchRecord(ref)` on hover, `openRecord(ref)` on click. Which
 * query backs which kind is decided here rather than in each of the three
 * tables, for the same reason `useCrmCache` owns invalidation.
 */
export function usePrefetchRecord() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	return useCallback(
		({ kind, id }: RecordRef) => {
			// A switch rather than a kind → options lookup: each procedure returns a
			// different row shape, so a map of them is a union `prefetchQuery` will
			// not accept. Three lines, and every branch keeps its own types.
			switch (kind) {
				case "company":
					void queryClient.prefetchQuery(
						trpc.companies.byId.queryOptions({ id }),
					);
					return;
				case "contact":
					void queryClient.prefetchQuery(
						trpc.contacts.byId.queryOptions({ id }),
					);
					return;
				case "deal":
					void queryClient.prefetchQuery(trpc.deals.byId.queryOptions({ id }));
					return;
			}
		},
		[trpc, queryClient],
	);
}
