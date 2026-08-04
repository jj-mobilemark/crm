"use client";

import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import Close from "@carbon/icons-react/es/Close";
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
import { formatCompanyDisambiguation } from "@/components/crm/company-disambiguation";
import { useTRPC } from "@/lib/trpc/client";

/** How long to wait after a keystroke before asking the API. */
const SEARCH_DEBOUNCE_MS = 200;

const ALL = "all";
const NONE = "none";

type PickedCompany = {
	id: string;
	name: string;
	iconUrl?: string | null;
	iconDarkUrl?: string | null;
	iconTone?: string | null;
};

type CompanyPickerBase = {
	id?: string;
	placeholder?: string;
	includeNone?: boolean;
	noneLabel?: string;
	/**
	 * `field` fills a form row. `filter` matches DataTable facet buttons
	 * (compact trigger, wider popover for search). `inline` matches sheet
	 * property rows (ghost until hover).
	 */
	variant?: "field" | "filter" | "inline";
};

type CompanyPickerFormProps = CompanyPickerBase & {
	/** Form mode: company id, or `null` for none. */
	value: string | null;
	onChange: (companyId: string | null) => void;
	allowAll?: false;
};

type CompanyPickerFilterProps = CompanyPickerBase & {
	/**
	 * Filter mode: `"all"` (no filter), `"none"` (company-less), or a company id.
	 */
	value: string;
	onChange: (value: string) => void;
	allowAll: true;
	allLabel?: string;
};

export type CompanyPickerProps = CompanyPickerFormProps | CompanyPickerFilterProps;

/**
 * A searchable company picker for forms and table facets.
 *
 * The API matches server-side (`companies.options`, capped at 100), so this
 * scales to a CRM with thousands of imported companies where a plain dropdown
 * would render every row. Typing narrows the list; `""` shows the first
 * hundred alphabetically.
 */
export function CompanyPicker(props: CompanyPickerProps) {
	const {
		id,
		placeholder = "Choose a company",
		includeNone = false,
		noneLabel = "No company",
		variant = "field",
	} = props;
	const allowAll = props.allowAll === true;
	const allLabel = allowAll ? (props.allLabel ?? "Company") : "Company";
	const trpc = useTRPC();

	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	// The last company chosen here, kept so the trigger can label the selection
	// without another lookup once it is known.
	const [picked, setPicked] = useState<PickedCompany | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const companyId = allowAll
		? props.value !== ALL && props.value !== NONE
			? props.value
			: null
		: props.value;

	const results = useQuery({
		...trpc.companies.options.queryOptions({ q: debounced }),
		enabled: open,
		// Keep the previous list on screen while the next one loads, so the
		// options don't blank out on every keystroke.
		placeholderData: (previous) => previous,
	});

	// A value set from outside (or before anything was picked) needs its name
	// resolved for the trigger — it may not be in the first hundred.
	const needsLookup = companyId !== null && picked?.id !== companyId;
	const lookup = useQuery({
		...trpc.companies.byId.queryOptions({ id: companyId ?? "" }),
		enabled: needsLookup,
	});

	const selected: PickedCompany | null =
		companyId === null
			? null
			: picked?.id === companyId
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

	function chooseCompany(company: PickedCompany) {
		setPicked(company);
		props.onChange(company.id);
		handleOpenChange(false);
	}

	function chooseNone() {
		setPicked(null);
		if (props.allowAll) {
			props.onChange(NONE);
		} else {
			props.onChange(null);
		}
		handleOpenChange(false);
	}

	function chooseAll() {
		setPicked(null);
		if (props.allowAll) props.onChange(ALL);
		handleOpenChange(false);
	}

	const options = results.data ?? [];
	const isFilter = variant === "filter";
	const isInline = variant === "inline";
	const showNoneSelected = allowAll
		? props.value === NONE
		: includeNone && props.value === null;
	const showAllSelected = allowAll && props.value === ALL;
	// Filter chips need a one-click way back to "all" — opening the menu to pick
	// the label again is easy to miss once a company name fills the trigger.
	const canClear = allowAll && props.value !== ALL;

	return (
		<div
			className={cn(
				"inline-flex min-w-0 items-center",
				isFilter ? "max-w-56" : "w-full",
			)}
		>
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<Button
						id={id}
						type="button"
						variant={isInline ? "ghost" : "outline"}
						size={isFilter || isInline ? "sm" : "default"}
						role="combobox"
						aria-expanded={open}
						className={cn(
							"min-w-0 flex-1 justify-between font-normal",
							isInline &&
								"h-8 border border-transparent px-2 hover:border-input hover:bg-muted/40",
							canClear && "rounded-r-none border-r-0",
						)}
					>
						<span className="flex min-w-0 items-center gap-2">
							{selected ? (
								<>
									<EntityLogo
										src={selected.iconUrl}
										darkSrc={selected.iconDarkUrl}
										tone={
											selected.iconTone as EntityLogoTone | null | undefined
										}
										name={selected.name}
										size="xs"
									/>
									<span className="truncate">{selected.name}</span>
								</>
							) : showNoneSelected ? (
								<span className="truncate">{noneLabel}</span>
							) : showAllSelected || allowAll ? (
								<span className="truncate">{allLabel}</span>
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
					className={
						isFilter
							? "w-72"
							: isInline
								? "w-80"
								: "w-(--radix-popover-trigger-width)"
					}
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

							{allowAll ? (
								<CommandItem
									value="__all__"
									onSelect={chooseAll}
									className={cn(props.value === ALL && "text-foreground")}
								>
									<span className="text-muted-foreground">{allLabel}</span>
								</CommandItem>
							) : null}

							{includeNone ? (
								<CommandItem
									value="__none__"
									onSelect={chooseNone}
									className={cn(showNoneSelected && "text-foreground")}
								>
									<span className="text-muted-foreground">{noneLabel}</span>
								</CommandItem>
							) : null}

							{options.map((option) => (
								<CommandItem
									key={option.id}
									value={option.id}
									onSelect={() => chooseCompany(option)}
								>
									<EntityLogo
										src={option.iconUrl}
										name={option.name}
										size="sm"
									/>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{option.name}</span>
										<span className="truncate text-muted-foreground text-xs">
											{formatCompanyDisambiguation({
												sage100CustomerNo: option.sage100CustomerNo,
												contactCount: option.contactCount,
											})}
										</span>
									</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			{canClear ? (
				<Button
					type="button"
					variant="outline"
					size={isFilter ? "sm" : "default"}
					className="rounded-l-none px-2"
					aria-label="Clear company filter"
					onClick={chooseAll}
				>
					<Icon icon={Close} motion="none" />
				</Button>
			) : null}
		</div>
	);
}
