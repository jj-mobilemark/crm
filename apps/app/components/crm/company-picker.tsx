"use client";

import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import { Button } from "@crm/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@crm/ui/components/command";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@crm/ui/components/popover";
import { cn } from "@crm/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

/** How long to wait after a keystroke before asking the API. */
const SEARCH_DEBOUNCE_MS = 200;

type PickedCompany = {
	id: string;
	name: string;
	iconUrl?: string | null;
	iconDarkUrl?: string | null;
	iconTone?: string | null;
};

/**
 * A searchable company picker for forms.
 *
 * The API matches server-side (`companies.options`, capped at 100), so this
 * scales to a CRM with thousands of imported companies where a plain dropdown
 * would render every row. Typing narrows the list; `""` shows the first
 * hundred alphabetically.
 */
export function CompanyPicker({
	id,
	value,
	onChange,
	placeholder = "Choose a company",
	includeNone = false,
	noneLabel = "No company",
}: {
	id?: string;
	/** The selected company id, or `null` for none. */
	value: string | null;
	onChange: (companyId: string | null) => void;
	placeholder?: string;
	/** Offer a "No company" option (contacts can be company-less). */
	includeNone?: boolean;
	noneLabel?: string;
}) {
	const trpc = useTRPC();

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	// The last company chosen here, kept so the trigger can label the selection
	// without another lookup once it is known.
	const [picked, setPicked] = useState<PickedCompany | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const results = useQuery({
		...trpc.companies.options.queryOptions({ q: debounced }),
		enabled: open,
		// Keep the previous list on screen while the next one loads, so the
		// options don't blank out on every keystroke.
		placeholderData: (previous) => previous,
	});

	// A value set from outside (or before anything was picked) needs its name
	// resolved for the trigger — it may not be in the first hundred.
	const needsLookup = value !== null && picked?.id !== value;
	const lookup = useQuery({
		...trpc.companies.byId.queryOptions({ id: value ?? "" }),
		enabled: needsLookup,
	});

	const selected: PickedCompany | null =
		value === null
			? null
			: picked?.id === value
				? picked
				: (lookup.data ?? null);

	function handleQueryChange(next: string) {
		setQuery(next);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setDebounced(next), SEARCH_DEBOUNCE_MS);
	}

	function handleOpenChange(next: boolean) {
		setOpen(next);
		if (!next) {
			// Reset the search so reopening starts clean.
			setQuery("");
			setDebounced("");
			if (timer.current) clearTimeout(timer.current);
		}
	}

	function choose(company: PickedCompany | null) {
		setPicked(company);
		onChange(company?.id ?? null);
		handleOpenChange(false);
	}

	const options = results.data ?? [];

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className="w-full justify-between font-normal"
				>
					<span className="flex min-w-0 items-center gap-2">
						{selected ? (
							<>
								<EntityLogo
									src={selected.iconUrl}
									darkSrc={selected.iconDarkUrl}
									tone={selected.iconTone as EntityLogoTone | null | undefined}
									name={selected.name}
									size="xs"
								/>
								<span className="truncate">{selected.name}</span>
							</>
						) : (
							<span className="truncate text-muted-foreground">
								{placeholder}
							</span>
						)}
					</span>
					<Icon
						icon={ChevronDown}
						motion="none"
						className="shrink-0 opacity-50"
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				size="fit"
				className="w-(--radix-popover-trigger-width)"
			>
				{/*
				 * `shouldFilter={false}`: the API already matched on name and domain,
				 * including domains the row does not show. Re-filtering in cmdk would
				 * drop those hits.
				 */}
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search companies…"
						value={query}
						onValueChange={handleQueryChange}
					/>
					<CommandList>
						<CommandEmpty>
							{results.isFetching ? "Searching…" : "No companies match."}
						</CommandEmpty>

						{includeNone ? (
							<CommandItem
								value="__none__"
								onSelect={() => choose(null)}
								className={cn(value === null && "text-foreground")}
							>
								<span className="text-muted-foreground">{noneLabel}</span>
							</CommandItem>
						) : null}

						{options.map((option) => (
							<CommandItem
								key={option.id}
								value={option.id}
								onSelect={() => choose(option)}
							>
								<EntityLogo src={option.iconUrl} name={option.name} size="sm" />
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{option.name}</span>
									{option.domain ? (
										<span className="truncate text-muted-foreground text-xs">
											{option.domain}
										</span>
									) : null}
								</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
