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
import Link from "next/link";
import { useQueryStates } from "nuqs";
import { recordHref } from "@/lib/record-href";
import { useTRPC } from "@/lib/trpc/client";
import { CompaniesMapCanvas } from "./companies-map-canvas";
import { mapParsers, mapQueryInput } from "./map-search-params";

export function MapPanel() {
	const trpc = useTRPC();
	const [params, setParams] = useQueryStates(mapParsers);
	const input = mapQueryInput(params);

	const [searchValue, setSearchValue] = useSearchInput(params.q, (next) =>
		void setParams({ q: next, selected: "" }),
	);

	const mapList = useQuery({
		...trpc.companies.mapList.queryOptions(input),
	});

	const rows = mapList.data?.rows ?? [];
	const selected = rows.find((row) => row.id === params.selected) ?? null;

	const points = rows.flatMap((row) =>
		row.latitude != null && row.longitude != null
			? [
					{
						id: row.id,
						name: row.name,
						latitude: row.latitude,
						longitude: row.longitude,
						isMine: row.isMine,
						sageCrmCompanyId: row.sageCrmCompanyId,
					},
				]
			: [],
	);

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
							void setParams({
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
							void setParams({
								sage: value as typeof params.sage,
								selected: "",
							});
						}}
						variant="outline"
						size="sm"
						className="justify-start"
					>
						<ToggleGroupItem value="all">Any Sage</ToggleGroupItem>
						<ToggleGroupItem value="linked">Has Sage ID</ToggleGroupItem>
						<ToggleGroupItem value="unlinked">No Sage ID</ToggleGroupItem>
					</ToggleGroup>
					<ToggleGroup
						type="single"
						value={params.hasLocation}
						onValueChange={(value) => {
							if (!value) return;
							void setParams({
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
								void setParams({
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
								void setParams({
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

				<p className="text-muted-foreground text-xs">
					{mapList.isLoading
						? "Loading…"
						: `${rows.length.toLocaleString()} companies · ${points.length.toLocaleString()} on map`}
				</p>

				<ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
					{rows.map((row) => {
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
													: row.sageCrmCompanyId
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
					{!mapList.isLoading && rows.length === 0 ? (
						<li className="px-3 py-6 text-center text-muted-foreground text-sm">
							No companies match these filters.
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
						Has Sage ID
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-warning" aria-hidden />
						No Sage ID
					</span>
				</div>

				<div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
					{mapList.isLoading ? (
						<div className="flex size-full min-h-[28rem] items-center justify-center text-muted-foreground text-sm">
							Loading map…
						</div>
					) : (
						<CompaniesMapCanvas
							points={points}
							selectedId={selected?.id ?? ""}
							onSelect={(id) => void setParams({ selected: id })}
						/>
					)}
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
								{selected.sageCrmCompanyId
									? ` · Sage ${selected.sageCrmCompanyId}`
									: " · Not in Sage"}
							</p>
						</div>
						<Button asChild>
							<Link href={recordHref("/companies", "company", selected.id)}>
								Open company
							</Link>
						</Button>
					</div>
				) : null}
			</section>
		</div>
	);
}
