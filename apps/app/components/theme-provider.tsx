"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

// next-themes injects an inline <script> to set the theme before paint. That
// script runs correctly from the SSR HTML, but React 19 flags every inline
// script a component renders. The warning is a false positive here, and
// next-themes is unmaintained, so we silence this one message in dev only.
if (
	typeof window !== "undefined" &&
	process.env.NODE_ENV === "development" &&
	!(console as { __themeScriptPatched?: boolean }).__themeScriptPatched
) {
	(console as { __themeScriptPatched?: boolean }).__themeScriptPatched = true;
	const original = console.error;
	console.error = (...args: unknown[]) => {
		if (
			typeof args[0] === "string" &&
			args[0].includes("Encountered a script tag")
		) {
			return;
		}
		original.apply(console, args);
	};
}

export function ThemeProvider({
	children,
	...props
}: React.ComponentProps<typeof NextThemesProvider>) {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
			{...props}
		>
			{children}
		</NextThemesProvider>
	);
}
