"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@crm/ui/components/accordion";
import { Skeleton } from "@crm/ui/components/skeleton";
import { ThreadMessage } from "@crm/ui/components/thread-message";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

const timeFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/**
 * A synced mail thread, collapsed to one line.
 *
 * The messages are fetched only when it is opened: the timeline payload carries
 * a snippet and a count, and email bodies are the one thing that must never
 * ride along on a list response.
 *
 * `provider` picks which tRPC surface to call. Both return the same shape
 * (gmailUrl and outlookUrl); the deep-link that is set wins in the UI.
 */
export function EmailThreadEntry({
	threadId,
	messageCount,
	provider = "google",
}: {
	threadId: string;
	messageCount: number;
	provider?: "google" | "microsoft";
}) {
	const trpc = useTRPC();
	const [opened, setOpened] = useState(false);

	const googleThread = useQuery({
		...trpc.google.thread.queryOptions({ threadId }),
		enabled: opened && provider === "google",
	});

	const microsoftThread = useQuery({
		...trpc.microsoft.thread.queryOptions({ threadId }),
		enabled: opened && provider === "microsoft",
	});

	const thread = provider === "microsoft" ? microsoftThread : googleThread;

	return (
		<Accordion
			type="single"
			collapsible
			onValueChange={(value) => {
				// Latched: collapsing again should not throw away what we fetched.
				if (value) setOpened(true);
			}}
		>
			<AccordionItem value={threadId}>
				<AccordionTrigger variant="subtle">
					{messageCount === 1 ? "1 message" : `${messageCount} messages`}
				</AccordionTrigger>

				<AccordionContent>
					{thread.isPending ? (
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-1/3" />
							<Skeleton className="h-4 w-2/3" />
						</div>
					) : thread.isError ? (
						<p className="text-muted-foreground text-xs">
							{thread.error.message}
						</p>
					) : (
						<div className="flex flex-col">
							{thread.data?.messages.map((message) => {
								const openUrl = message.outlookUrl ?? message.gmailUrl ?? null;
								const openLabel = message.outlookUrl
									? "Open in Outlook"
									: message.gmailUrl
										? "Open in Gmail"
										: null;

								return (
									<ThreadMessage
										key={message.id}
										from={message.fromName ?? message.fromEmail}
										fromEmail={message.fromEmail}
										sentAt={timeFormat.format(new Date(message.sentAt))}
										direction={message.direction}
										body={message.body}
										action={
											openUrl && openLabel ? (
												<a
													href={openUrl}
													target="_blank"
													rel="noreferrer"
													className="text-muted-foreground underline underline-offset-3 hover:text-foreground"
												>
													{openLabel}
												</a>
											) : null
										}
									/>
								);
							})}
						</div>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
