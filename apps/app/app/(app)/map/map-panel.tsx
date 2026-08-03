"use client";

import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useSearchInput } from "@crm/ui/hooks/use-search-input";
import { cn } from "@crm/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { useRef, useState } from "react";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useTRPC } from "@/lib/trpc/client";
import {
	CompaniesMapCanvas,
	type MapLatLngBounds,
} from "./companies-map-canvas";
import { mapParsers, mapQueryInput } from "./map-search-params";

function inBounds(
	latitude: number,
	longitude: number,
	bounds: MapLatLngBounds,
): boolean {
	if (latitude < bounds.south || latitude > bounds.north) return false;
	// Leaflet can report west > east when the view crosses the antimeridian.
	if (bounds.west <= bounds.east) {
		return longitude >= bounds.west && longitude <= bounds.east;
	}
	return longitude >= bounds.west || longitude <= bounds.east;
}

/** Ignore getBounds() from an unsized / not-yet-laid-out map. */
function isUsableBounds(bounds: MapLatLngBounds): boolean {
	const latSpan = bounds.north - bounds.south;
	const lngSpan =
		bounds.west <= bounds.east
			? bounds.east - bounds.west
			: 360 - (bounds.west - bounds.east);
	return latSpan > 0.05 && lngSpan > 0.05;
}

function boundsKey(bounds: MapLatLngBounds): string {
	return `${bounds.north}:${bounds.south}:${bounds.east}:${bounds.west}`;
}

export function MapPanel() {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const [params, setParams] = useQueryStates(mapParsers);
	const input = mapQueryInput(params);
	/** Company ids inside the last-clicked map cluster; null = use viewport. */
	const [clusterIds, setClusterIds] = useState<string[] | null>(null);
	const [mapBounds, setMapBounds] = useState<MapLatLngBounds | null>(null);
	const lastBoundsKeyRef = useRef<string | null>(null);

	const [searchValue, setSearchValue] = useSearchInput(params.q, (next) => {
		setClusterIds(null);
		setMapBounds(null);
		lastBoundsKeyRef.current = null;
		void setParams({ q: next, selected: "" });
	});

	const mapList = useQuery({
		...trpc.companies.mapList.queryOptions(input),
		// Keep pins/list visible while a filter refetch runs — otherwise the map
		// unmounts, remounts ~12k markers, and the UI flashes empty.
		placeholderData: (previous) => previous,
	});

	const rows = mapList.data?.rows ?? [];
	const clusterIdSet =
		clusterIds == null ? null : new Set(clusterIds);
	const usableBounds =
		mapBounds != null && isUsableBounds(mapBounds) ? mapBounds : null;

	const listRows = (() => {
		if (clusterIdSet != null) {
			return rows.filter((row) => clusterIdSet.has(row.id));
		}
		if (usableBounds == null || params.hasLocation === "no") {
			return rows;
		}
		return rows.filter(
			(row) =>
				row.latitude != null &&
				row.longitude != null &&
				inBounds(row.latitude, row.longitude, usableBounds),
		);
	})();

	const selected =
		listRows.find((row) => row.id === params.selected) ??
		rows.find((row) => row.id === params.selected) ??
		null;

	const points = rows.flatMap((row) =>
		row.latitude != null && row.longitude != null
			? [
					{
						id: row.id,
						name: row.name,
						latitude: row.latitude,
						longitude: row.longitude,
						isMine: row.isMine,
						sage100CustomerNo: row.sage100CustomerNo,
					},
				]
			: [],
	);

	function clearMapFocusAndSet(patch: Parameters<typeof setParams>[0]) {
		setClusterIds(null);
		// Drop stale viewport so the list shows every match until the map
		// reports bounds for the current view again.
		setMapBounds(null);
		lastBoundsKeyRef.current = null;
		void setParams(patch);
	}

	const viewportActive =
		clusterIdSet == null &&
		usableBounds != null &&
		params.hasLocation !== "no";
	const initialLoading = mapList.isPending && !mapList.data;
	const filterError =
		mapList.error instanceof Error
			? mapList.error.message
			: mapList.error
				? String(mapList.error)
				: null;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
			<aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-96">
				<div className="flex flex-col gap-2">
					<Input
						value={searchValue}
						onChange={(event) => setSearchValue(event.target.value)}
						placeholder="Search by name or domain…"
						aria-label="Search companies"
					/>
					<ToggleGroup
						type="single"
						value={params.owner}
						onValueChange={(value) => {
							if (!value) return;
							clearMapFocusAndSet({
								owner: value as typeof params.owner,
								selected: "",
							});
						}}
						variant="outline"
						size="sm"
						className="justify-start"
					>
						<ToggleGroupItem value="all">All owners</ToggleGroupItem>
						<ToggleGroupItem value="me">My accounts</ToggleGroupItem>
						<ToggleGroupItem value="unassigned">Unassigned</ToggleGroupItem>
					</ToggleGroup>
					<ToggleGroup
						type="single"
						value={params.sage}
						onValueChange={(value) => {
							if (!value) return;
							clearMapFocusAndSet({
								sage: value as typeof params.sage,
								selected: "",
							});
						}}
						variant="outline"
						size="sm"
						className="justify-start"
					>
						<ToggleGroupItem value="all">Any Sage 100</ToggleGroupItem>
						<ToggleGroupItem value="linked">Has Sage 100</ToggleGroupItem>
						<ToggleGroupItem value="unlinked">No Sage 100</ToggleGroupItem>
					</ToggleGroup>
					<ToggleGroup
						type="single"
						value={params.hasLocation}
						onValueChange={(value) => {
							if (!value) return;
							clearMapFocusAndSet({
								hasLocation: value as typeof params.hasLocation,
								selected: "",
							});
						}}
						variant="outline"
						size="sm"
						className="justify-start"
					>
						<ToggleGroupItem value="all">Any location</ToggleGroupItem>
						<ToggleGroupItem value="yes">On map</ToggleGroupItem>
						<ToggleGroupItem value="no">Missing pin</ToggleGroupItem>
					</ToggleGroup>
					<div className="flex gap-2">
						<Select
							value={params.sort}
							onValueChange={(value) =>
								clearMapFocusAndSet({
									sort: value as typeof params.sort,
									selected: "",
								})
							}
						>
							<SelectTrigger aria-label="Sort by" className="flex-1">
								<SelectValue placeholder="Sort" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="name">Name</SelectItem>
								<SelectItem value="city">City</SelectItem>
								<SelectItem value="owner">Owner</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={params.dir}
							onValueChange={(value) =>
								clearMapFocusAndSet({
									dir: value as typeof params.dir,
									selected: "",
								})
							}
						>
							<SelectTrigger aria-label="Sort direction" className="w-28">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="asc">Asc</SelectItem>
								<SelectItem value="desc">Desc</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					<span>
						{initialLoading
							? "Loading…"
							: mapList.isFetching
								? `Updating… · ${points.length.toLocaleString()} on map`
								: clusterIdSet != null
									? `${listRows.length.toLocaleString()} in cluster · ${rows.length.toLocaleString()} match filters`
									: viewportActive
										? `${listRows.length.toLocaleString()} in view · ${points.length.toLocaleString()} on map`
										: `${rows.length.toLocaleString()} companies · ${points.length.toLocaleString()} on map`}
					</span>
					{clusterIdSet != null ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								setClusterIds(null);
								void setParams({ selected: "" });
							}}
						>
							Clear cluster
						</Button>
					) : null}
				</div>

				{filterError ? (
					<p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-sm">
						Could not load companies: {filterError}
					</p>
				) : null}

				<ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
					{listRows.map((row) => {
						const active = selected?.id === row.id;
						const place = [row.city, row.stateCode].filter(Boolean).join(", ");
						return (
							<li
								key={row.id}
								className="border-border border-b last:border-b-0"
							>
								<button
									type="button"
									onClick={() => void setParams({ selected: row.id })}
									className={cn(
										"flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
										active && "bg-muted",
									)}
								>
									<span className="flex items-center gap-2 font-medium">
										<span
											className={cn(
												"size-2 shrink-0 rounded-full",
												row.isMine
													? "bg-primary"
													: row.sage100CustomerNo
														? "bg-chart-2"
														: "bg-warning",
											)}
											aria-hidden
										/>
										<span className="truncate">{row.name}</span>
									</span>
									<span className="truncate text-muted-foreground text-xs">
										{place || "No city"}
										{row.owner ? ` · ${row.owner.name}` : " · Unassigned"}
										{row.latitude == null ? " · No pin" : ""}
									</span>
								</button>
							</li>
						);
					})}
					{!initialLoading && !filterError && listRows.length === 0 ? (
						<li className="px-3 py-6 text-center text-muted-foreground text-sm">
							{clusterIdSet != null
								? "No companies in this cluster match the current filters."
								: rows.length > 0 && points.length === 0
									? "Matching companies have no map pins yet. Run the geocode script or choose “Missing pin”."
									: viewportActive
										? "No companies with pins in this map view. Pan or zoom out, or clear filters."
										: "No companies match these filters."}
						</li>
					) : null}
				</ul>
			</aside>

			<section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
				<div className="flex flex-wrap items-center gap-4 text-muted-foreground text-xs">
					<span className="inline-flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-primary" aria-hidden />
						My accounts
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-chart-2" aria-hidden />
						Has Sage 100
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-warning" aria-hidden />
						No Sage 100
					</span>
				</div>

				<div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
					{initialLoading ? (
						<div className="flex size-full min-h-[28rem] items-center justify-center text-muted-foreground text-sm">
							Loading map…
						</div>
					) : (
						<CompaniesMapCanvas
							points={points}
							selectedId={selected?.id ?? ""}
							onSelect={(id) => void setParams({ selected: id })}
							onClusterSelect={(ids) => {
								setClusterIds(ids);
								void setParams({ selected: "" });
							}}
							onBoundsChange={(bounds) => {
								if (!isUsableBounds(bounds)) return;
								const key = boundsKey(bounds);
								if (lastBoundsKeyRef.current !== key) {
									lastBoundsKeyRef.current = key;
									setClusterIds(null);
								}
								setMapBounds(bounds);
							}}
						/>
					)}
					{mapList.isFetching && !initialLoading ? (
						<div className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/90 px-2 py-1 text-muted-foreground text-xs shadow-sm">
							Updating…
						</div>
					) : null}
				</div>

				{selected ? (
					<div className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 flex flex-col gap-1">
							<p className="truncate font-medium">{selected.name}</p>
							<p className="truncate text-muted-foreground text-sm">
								{[selected.city, selected.stateCode, selected.country]
									.filter(Boolean)
									.join(", ") || "No location on file"}
								{selected.domain ? ` · ${selected.domain}` : ""}
								{selected.owner ? ` · ${selected.owner.name}` : " · Unassigned"}
								{selected.sage100CustomerNo
									? ` · Sage 100 ${selected.sage100CustomerNo}`
									: " · No Sage 100"}
							</p>
						</div>
						<Button
							type="button"
							onClick={() =>
								openRecord({ kind: "company", id: selected.id })
							}
						>
							Open company
						</Button>
					</div>
				) : null}
			</section>
		</div>
	);
}
