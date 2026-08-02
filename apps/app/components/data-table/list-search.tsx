"use client";

import Search from "@carbon/icons-react/es/Search";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@crm/ui/components/input-group";
import { useSearchInput } from "@crm/ui/hooks/use-search-input";
import { useQueryStates } from "nuqs";
import { searchParsers } from "./list-search-params";

/**
 * The list's search box, in the page header rather than above the table.
 *
 * It shares no props with the table and needs none: both read `q` out of the
 * URL, so typing here updates the table without either knowing the other
 * exists. The table renders no search field at all, so there is only ever one
 * input bound to the value.
 *
 * `q` and `page` are the same two keys on every list, so this takes no parser
 * map and is safe to render straight from a server page.
 */
export function ListSearch({ placeholder }: { placeholder: string }) {
	const [{ q }, setState] = useQueryStates(searchParsers);

	// Back to page 1: staying on page 7 of a result set that now has two pages
	// shows an empty table.
	const [value, setValue] = useSearchInput(q, (next) =>
		setState({ q: next, page: 1 }),
	);

	return (
		<InputGroup className="w-full sm:w-64">
			<InputGroupAddon>
				<Search />
			</InputGroupAddon>
			<InputGroupInput
				placeholder={placeholder}
				value={value}
				onChange={(event) => setValue(event.target.value)}
				autoComplete="off"
			/>
		</InputGroup>
	);
}
