"use client";

import {
	Card,
	CardAction,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Spinner } from "@crm/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { OwnerCell } from "@/components/crm/owner-cell";
import { useTRPC } from "@/lib/trpc/client";
import { CertaintyByRepWindowControl } from "./certainty-by-rep-window";
import { overviewParsers } from "./overview-search-params";

/**
 * Everyone overview: reps × deal-maturity (stage) bands for a historical
 * close window. Counts only — open by expected close, won/lost by closedAt.
 */
export function CertaintyByRepGrid() {
	const trpc = useTRPC();
	const [params] = useQueryStates(overviewParsers);

	const input = {
		window: params.certWindow,
		...(params.certWindow === "custom" && params.certFrom && params.certTo
			? { from: params.certFrom, to: params.certTo }
			: {}),
	};

	const query = useQuery({
		...trpc.dashboard.certaintyByRep.queryOptions(input),
		placeholderData: (previous) => previous,
	});

	const data = query.data;

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Deal Maturity by rep</CardTitle>
				<CardDescription>
					Open deals by expected close; Closed won / lost by close date —
					deal counts
				</CardDescription>
				<CardAction>
					<CertaintyByRepWindowControl />
				</CardAction>
			</CardHeader>
			{!data ? (
				<div className="flex justify-center px-5 py-10">
					<Spinner />
				</div>
			) : data.rows.length === 0 ? (
				<div className="px-5 py-10 text-center text-muted-foreground text-sm md:px-6">
					No deals in {data.window.label.toLowerCase()}.
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[40rem] border-collapse text-sm">
						<thead>
							<tr className="border-b text-muted-foreground text-xs">
								<th className="px-3 py-2.5 text-left font-medium">Rep</th>
								{data.columns.map((column) => (
									<th
										key={column.stage}
										className="px-2 py-2.5 text-center font-medium"
									>
										<span className="flex flex-col items-center gap-0.5">
											<span className="text-foreground text-sm">
												{column.label}
											</span>
											<span className="font-normal text-[0.65rem] leading-tight tabular-nums">
												{column.certainty}%
											</span>
										</span>
									</th>
								))}
								<th className="px-3 py-2.5 text-right font-medium">Total</th>
							</tr>
						</thead>
						<tbody>
							{data.rows.map((row) => (
								<tr key={row.owner.id} className="border-b last:border-b-0">
									<td className="px-3 py-2.5 align-middle">
										<OwnerCell owner={row.owner} />
									</td>
									{row.cells.map((count, index) => (
										<td
											key={data.columns[index]?.stage ?? index}
											className="px-2 py-2.5 text-center tabular-nums align-middle"
										>
											{count === 0 ? <EmptyCellValue /> : count}
										</td>
									))}
									<td className="px-3 py-2.5 text-right font-medium tabular-nums align-middle">
										{row.total}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Card>
	);
}
