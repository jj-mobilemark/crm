"use client";

import Close from "@carbon/icons-react/es/Close";
import { Button } from "@crm/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@crm/ui/components/command";
import { Icon } from "@crm/ui/components/icon";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@crm/ui/components/popover";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { formatCompanyDisambiguation } from "@/components/crm/company-disambiguation";
import { useTRPC } from "@/lib/trpc/client";

const SEARCH_DEBOUNCE_MS = 200;

type Picked = {
	id: string;
	name: string;
	sage100CustomerNo?: string | null;
	contactCount?: number;
};

/**
 * Multi-select company picker for Trip Planner must-visits.
 * When hub coords are set, prefers companies within `radiusMiles`.
 *
 * Selected ids are resolved via `companies.byIds` so chips show names after
 * reload — not only after a pick in this session.
 */
export function CompanyMultiPicker({
	value,
	onChange,
	hubLatitude,
	hubLongitude,
	radiusMiles = 200,
	placeholder = "Add companies to visit",
}: {
	value: string[];
	onChange: (ids: string[]) => void;
	hubLatitude?: number | null;
	hubLongitude?: number | null;
	radiusMiles?: number;
	placeholder?: string;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [labels, setLabels] = useState<Map<string, Picked>>(new Map());
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const nearHub =
		hubLatitude != null &&
		hubLongitude != null &&
		Number.isFinite(hubLatitude) &&
		Number.isFinite(hubLongitude);

	const near = useQuery({
		...trpc.companies.nearHub.queryOptions({
			q: debounced,
			hubLatitude: hubLatitude ?? 0,
			hubLongitude: hubLongitude ?? 0,
			radiusMiles,
		}),
		enabled: open && nearHub,
		placeholderData: (previous) => previous,
	});

	const options = useQuery({
		...trpc.companies.options.queryOptions({ q: debounced }),
		enabled: open && !nearHub,
		placeholderData: (previous) => previous,
	});

	const lookup = useQuery({
		...trpc.companies.byIds.queryOptions({ ids: value }),
		enabled: value.length > 0,
	});

	const rows = (nearHub ? near.data : options.data) ?? [];
	const lookedUp = new Map(
		(lookup.data ?? []).map((row) => [
			row.id,
			{
				id: row.id,
				name: row.name,
				sage100CustomerNo: row.sage100CustomerNo,
				contactCount: row.contactCount,
			} satisfies Picked,
		]),
	);

	function handleQueryChange(next: string) {
		setQuery(next);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setDebounced(next), SEARCH_DEBOUNCE_MS);
	}

	function toggle(company: Picked) {
		setLabels((prev) => new Map(prev).set(company.id, company));
		if (value.includes(company.id)) {
			onChange(value.filter((id) => id !== company.id));
		} else {
			onChange([...value, company.id]);
		}
	}

	function remove(id: string) {
		onChange(value.filter((x) => x !== id));
	}

	const selectedLabels = value.map((id) => {
		const fromRows = rows.find((r) => r.id === id);
		const cached = labels.get(id);
		const resolved = lookedUp.get(id);
		return (
			fromRows ??
			cached ??
			resolved ?? {
				id,
				name: lookup.isFetching ? "Loading…" : "Unknown company",
			}
		);
	});

	return (
		<div className="flex flex-col gap-2">
			{selectedLabels.length > 0 ? (
				<ul className="flex flex-wrap gap-1.5">
					{selectedLabels.map((company) => (
						<li
							key={company.id}
							className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs"
						>
							<span className="truncate font-medium text-foreground">
								{company.name}
							</span>
							<button
								type="button"
								className="hover:text-foreground shrink-0"
								aria-label={`Remove ${company.name}`}
								onClick={() => remove(company.id)}
							>
								<Icon icon={Close} size={12} />
							</button>
						</li>
					))}
				</ul>
			) : null}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button type="button" variant="outline" className="justify-start">
						{placeholder}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0" align="start">
					<Command shouldFilter={false}>
						<CommandInput
							placeholder="Search name or Sage 100 #"
							value={query}
							onValueChange={handleQueryChange}
						/>
						<CommandList>
							<CommandEmpty>
								{near.isFetching || options.isFetching
									? "Searching…"
									: nearHub
										? "No companies in range."
										: "No companies found."}
							</CommandEmpty>
							{rows.map((company) => {
								const selected = value.includes(company.id);
								const secondary = formatCompanyDisambiguation({
									sage100CustomerNo: company.sage100CustomerNo,
									contactCount: company.contactCount,
								});
								return (
									<CommandItem
										key={company.id}
										value={company.id}
										onSelect={() =>
											toggle({
												id: company.id,
												name: company.name,
												sage100CustomerNo: company.sage100CustomerNo,
												contactCount: company.contactCount,
											})
										}
									>
										<div className="flex min-w-0 flex-col">
											<span className="truncate">
												{selected ? "✓ " : ""}
												{company.name}
											</span>
											{secondary ? (
												<span className="text-muted-foreground truncate text-xs">
													{secondary}
												</span>
											) : null}
										</div>
									</CommandItem>
								);
							})}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{nearHub ? (
				<p className="text-muted-foreground text-xs">
					Showing companies within {radiusMiles} miles of the hub. Search still
					works by name or Sage 100 #.
				</p>
			) : (
				<p className="text-muted-foreground text-xs">
					Save the trip to filter by distance. You can still search all
					companies.
				</p>
			)}
		</div>
	);
}
