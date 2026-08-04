import { createListSearchParams } from "@/components/data-table/list-search-params";

/**
 * The companies list URL. Shared by the page's server-side prefetch and the
 * client table, so the two cannot ask for different things.
 */
export const companiesSearchParams = createListSearchParams({
	// Newest first: a CRM list is read to see what has changed, not to look
	// something up alphabetically — that is what ⌘K is for.
	defaultSort: "createdAt",
	defaultDir: "desc",
	facetIds: ["owner", "industry", "enrichment", "hideEmpty"] as const,
	// On by default: the list is for real accounts (contacts + Sage 100), not
	// empty shells from sync. Uncheck to audit the rest.
	facetDefaults: { hideEmpty: "yes" },
});
