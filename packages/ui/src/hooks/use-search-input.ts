"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A search box that types at keyboard speed and updates the URL afterwards.
 *
 * List state lives in the query string, so the obvious wiring — value from the
 * URL, `onChange` writes it straight back — puts a router transition between
 * the key press and the character appearing. Every keystroke re-renders the
 * page and the table with it, which reads as a laggy input even though the
 * fetch itself is already deferred.
 *
 * So the input is local state, and the URL is caught up once typing pauses.
 * The committed value is still the single source of truth: anything that
 * changes it elsewhere — the back button, a cleared filter, a reset link —
 * flows back down and replaces what is in the box.
 */
export function useSearchInput(
	committed: string,
	commit: (value: string) => void,
	delayMs = 250,
) {
	const [value, setValue] = useState(committed);

	// Kept in a ref so the debounce effect depends on the typed value alone.
	// `commit` is a fresh closure on every render, and depending on it directly
	// would restart the timer each time and never fire.
	const commitRef = useRef(commit);
	commitRef.current = commit;

	const committedRef = useRef(committed);
	committedRef.current = committed;

	// The URL changed without us: adopt it.
	useEffect(() => {
		setValue(committed);
	}, [committed]);

	useEffect(() => {
		if (value === committedRef.current) return;
		const timer = setTimeout(() => commitRef.current(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return [value, setValue] as const;
}
