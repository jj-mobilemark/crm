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
import { cn } from "@crm/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

const SEARCH_DEBOUNCE_MS = 200;

export type PickedContact = {
	id: string;
	firstName: string;
	lastName: string | null;
	email: string | null;
	company: { id: string; name: string } | null;
};

function contactLabel(c: PickedContact): string {
	const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
	return c.email ? `${name} <${c.email}>` : name;
}

type ContactMultiPickerProps = {
	value: PickedContact[];
	onChange: (contacts: PickedContact[]) => void;
	placeholder?: string;
	id?: string;
};

/**
 * Multi-select contact picker for sequence enrollment.
 *
 * Mirrors `CompanyPicker` search behaviour (`contacts.options`, capped at 100).
 */
export function ContactMultiPicker({
	value,
	onChange,
	placeholder = "Add contacts…",
	id,
}: ContactMultiPickerProps) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const results = useQuery({
		...trpc.contacts.options.queryOptions({ q: debounced }),
		enabled: open,
		placeholderData: (previous) => previous,
	});

	const selectedIds = new Set(value.map((c) => c.id));

	function handleQueryChange(next: string) {
		setQuery(next);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setDebounced(next), SEARCH_DEBOUNCE_MS);
	}

	function toggle(contact: PickedContact) {
		if (selectedIds.has(contact.id)) {
			onChange(value.filter((c) => c.id !== contact.id));
			return;
		}
		onChange([...value, contact]);
	}

	function remove(contactId: string) {
		onChange(value.filter((c) => c.id !== contactId));
	}

	return (
		<div className="flex flex-col gap-2">
			{value.length > 0 ? (
				<ul className="flex flex-wrap gap-2">
					{value.map((contact) => (
						<li
							key={contact.id}
							className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-sm"
						>
							<span className="max-w-56 truncate">{contactLabel(contact)}</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={`Remove ${contact.firstName}`}
								onClick={() => remove(contact.id)}
							>
								<Icon icon={Close} />
							</Button>
						</li>
					))}
				</ul>
			) : null}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						id={id}
						type="button"
						variant="outline"
						className={cn("justify-start font-normal", !value.length && "text-muted-foreground")}
					>
						{placeholder}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0" align="start">
					<Command shouldFilter={false}>
						<CommandInput
							placeholder="Search contacts…"
							value={query}
							onValueChange={handleQueryChange}
						/>
						<CommandList>
							<CommandEmpty>
								{results.isFetching ? "Searching…" : "No contacts with email."}
							</CommandEmpty>
							{(results.data ?? []).map((contact) => (
								<CommandItem
									key={contact.id}
									value={contact.id}
									onSelect={() =>
										toggle({
											id: contact.id,
											firstName: contact.firstName,
											lastName: contact.lastName,
											email: contact.email,
											company: contact.company,
										})
									}
								>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">
											{[contact.firstName, contact.lastName]
												.filter(Boolean)
												.join(" ")}
											{selectedIds.has(contact.id) ? " ✓" : ""}
										</span>
										<span className="truncate text-muted-foreground text-xs">
											{contact.email}
											{contact.company
												? ` · ${contact.company.name}`
												: ""}
										</span>
									</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
