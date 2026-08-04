"use client";

import Add from "@carbon/icons-react/es/Add";
import ArrowLeft from "@carbon/icons-react/es/ArrowLeft";
import DocumentExport from "@carbon/icons-react/es/DocumentExport";
import Plane from "@carbon/icons-react/es/Plane";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardPanel,
	CardPanelEmpty,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@crm/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSeparator,
	FieldSet,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@crm/ui/components/input-group";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Textarea } from "@crm/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { formatCount, relativeTimeFromIso } from "@crm/ui/lib/format";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useId, useState } from "react";
import { TripAgentPanel } from "@/components/crm/agent-panel";
import { CompanyMultiPicker } from "@/components/crm/company-multi-picker";
import { downloadTripPdf } from "@/lib/trip-pdf";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type TripListRow = RouterOutputs["tripPlans"]["list"][number];
type TripPlan = RouterOutputs["tripPlans"]["get"];

type FormState = {
	hubCity: string;
	hubStateCode: string;
	dayCount: number;
	radiusMiles: number;
	activityMode: "ACTIVE" | "SALVAGE";
	activityYears: number;
	mustVisitCompanyIds: string[];
	maxVisitsPerDay: string;
	notes: string;
};

const EMPTY_FORM: FormState = {
	hubCity: "",
	hubStateCode: "",
	dayCount: 3,
	radiusMiles: 200,
	activityMode: "ACTIVE",
	activityYears: 3,
	mustVisitCompanyIds: [],
	maxVisitsPerDay: "",
	notes: "",
};

function formFromPlan(plan: TripPlan): FormState {
	return {
		hubCity: plan.hubCity,
		hubStateCode: plan.hubStateCode,
		dayCount: plan.dayCount,
		radiusMiles: plan.radiusMiles,
		activityMode: plan.activityMode,
		activityYears: plan.activityYears,
		mustVisitCompanyIds: plan.mustVisitCompanyIds,
		maxVisitsPerDay:
			plan.maxVisitsPerDay != null ? String(plan.maxVisitsPerDay) : "",
		notes: plan.notes ?? "",
	};
}

function statusTone(status: TripListRow["status"]): "neutral" | "success" {
	return status === "PLANNED" ? "success" : "neutral";
}

function statusLabel(status: TripListRow["status"]): string {
	return status === "PLANNED" ? "Planned" : "Draft";
}

function activityLabel(mode: "ACTIVE" | "SALVAGE", years: number): string {
	return mode === "ACTIVE"
		? `Active · ${years}y`
		: `Salvage · ${years}y`;
}

function tripMeta(row: Pick<
	TripListRow,
	"dayCount" | "radiusMiles" | "activityMode" | "activityYears" | "mustVisitCount" | "hasItinerary"
>): string {
	const parts = [
		formatCount(row.dayCount, "day"),
		`${row.radiusMiles} mi`,
		activityLabel(row.activityMode, row.activityYears),
	];
	if (row.mustVisitCount > 0) {
		parts.push(formatCount(row.mustVisitCount, "must-visit"));
	}
	if (row.hasItinerary) {
		parts.push("itinerary");
	}
	return parts.join(" · ");
}

export function TripPlannerClient() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [{ trip }, setParams] = useQueryStates({
		trip: parseAsString,
	});
	const [creating, setCreating] = useState(false);
	const mode: "list" | "new" | "edit" = creating
		? "new"
		: trip
			? "edit"
			: "list";
	const [error, setError] = useState<string | null>(null);

	const list = useQuery(trpc.tripPlans.list.queryOptions());
	const selected = useQuery({
		...trpc.tripPlans.get.queryOptions({ id: trip ?? "" }),
		enabled: Boolean(trip) && mode === "edit",
		refetchInterval: trip && mode === "edit" ? 8_000 : false,
	});

	const invalidate = async (id?: string | null) => {
		await queryClient.invalidateQueries({
			queryKey: trpc.tripPlans.list.queryKey(),
		});
		if (id) {
			await queryClient.invalidateQueries({
				queryKey: trpc.tripPlans.get.queryKey({ id }),
			});
		}
	};

	const create = useMutation(
		trpc.tripPlans.create.mutationOptions({
			onSuccess: async (plan) => {
				setError(null);
				setCreating(false);
				await invalidate(plan.id);
				void setParams({ trip: plan.id });
			},
			onError: (err) => setError(err.message),
		}),
	);

	const update = useMutation(
		trpc.tripPlans.update.mutationOptions({
			onSuccess: async (plan) => {
				setError(null);
				await invalidate(plan.id);
			},
			onError: (err) => setError(err.message),
		}),
	);

	const remove = useMutation(
		trpc.tripPlans.delete.mutationOptions({
			onSuccess: async () => {
				setCreating(false);
				await setParams({ trip: null });
				await invalidate();
			},
			onError: (err) => setError(err.message),
		}),
	);

	function startNew() {
		setCreating(true);
		void setParams({ trip: null });
		setError(null);
	}

	function openTrip(id: string) {
		setCreating(false);
		void setParams({ trip: id });
		setError(null);
	}

	function backToList() {
		setCreating(false);
		void setParams({ trip: null });
		setError(null);
	}

	function saveForm(form: FormState) {
		setError(null);
		const payload = {
			hubCity: form.hubCity.trim(),
			hubStateCode: form.hubStateCode.trim().toUpperCase(),
			dayCount: form.dayCount,
			radiusMiles: form.radiusMiles,
			activityMode: form.activityMode,
			activityYears: form.activityYears,
			mustVisitCompanyIds: form.mustVisitCompanyIds,
			maxVisitsPerDay: form.maxVisitsPerDay
				? Number(form.maxVisitsPerDay)
				: null,
			notes: form.notes.trim() || null,
		};
		if (!payload.hubCity || payload.hubStateCode.length !== 2) {
			setError("Enter a hub city and a 2-letter state code.");
			return;
		}
		if (mode === "edit" && trip) {
			update.mutate({ id: trip, ...payload });
		} else {
			create.mutate(payload);
		}
	}

	function handleDownload() {
		const plan = selected.data;
		if (!plan?.itinerary) {
			setError("Ask the agent to finalize the itinerary first.");
			return;
		}
		try {
			downloadTripPdf({
				hubCity: plan.hubCity,
				hubStateCode: plan.hubStateCode,
				dayCount: plan.dayCount,
				radiusMiles: plan.radiusMiles,
				activityMode: plan.activityMode,
				activityYears: plan.activityYears,
				itinerary: plan.itinerary,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	const saving = create.isPending || update.isPending;
	const rows = list.data ?? [];

	if (mode === "new") {
		return (
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-fit"
					onClick={backToList}
				>
					<Icon icon={ArrowLeft} data-icon="inline-start" />
					Trips
				</Button>
				<TripBriefForm
					key="new"
					initial={EMPTY_FORM}
					error={error}
					saving={saving}
					isNew
					onSave={saveForm}
					onCancel={backToList}
				/>
			</div>
		);
	}

	if (mode === "edit" && trip) {
		if (selected.isLoading && !selected.data) {
			return (
				<div className="flex flex-1 items-center justify-center py-24">
					<Spinner />
				</div>
			);
		}

		if (!selected.data) {
			return (
				<div className="flex flex-col gap-4">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-fit"
						onClick={backToList}
					>
						<Icon icon={ArrowLeft} data-icon="inline-start" />
						Trips
					</Button>
					<Alert variant="destructive">
						<AlertTitle>Trip not found</AlertTitle>
						<AlertDescription>
							This trip may have been deleted. Pick another from your list.
						</AlertDescription>
					</Alert>
				</div>
			);
		}

		const plan = selected.data;

		return (
			<div className="flex min-w-0 flex-col gap-6">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-fit"
							onClick={backToList}
						>
							<Icon icon={ArrowLeft} data-icon="inline-start" />
							Trips
						</Button>
						<div className="flex min-w-0 flex-col gap-1">
							<div className="flex flex-wrap items-center gap-3">
								<h2 className="text-lg font-medium tracking-tight">
									{plan.hubCity}, {plan.hubStateCode}
								</h2>
								<StatusIndicator
									tone={statusTone(plan.status)}
									label={statusLabel(plan.status)}
								/>
							</div>
							<p className="text-muted-foreground text-sm">
								{tripMeta({
									dayCount: plan.dayCount,
									radiusMiles: plan.radiusMiles,
									activityMode: plan.activityMode,
									activityYears: plan.activityYears,
									mustVisitCount: plan.mustVisitCompanyIds.length,
									hasItinerary: Boolean(plan.itinerary),
								})}
							</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleDownload}
							disabled={!plan.itinerary}
						>
							<Icon icon={DocumentExport} data-icon="inline-start" />
							Download PDF
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								if (
									typeof window !== "undefined" &&
									window.confirm("Delete this trip?")
								) {
									remove.mutate({ id: trip });
								}
							}}
							disabled={remove.isPending}
						>
							{remove.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<Icon icon={TrashCan} data-icon="inline-start" />
							)}
							Delete
						</Button>
					</div>
				</div>

				{error ? (
					<Alert variant="destructive">
						<AlertTitle>Could not save</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				<div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
					<TripBriefForm
						key={trip}
						initial={formFromPlan(plan)}
						hubLatitude={plan.hubLatitude}
						hubLongitude={plan.hubLongitude}
						error={null}
						saving={saving}
						isNew={false}
						compact
						onSave={saveForm}
					/>

					<div className="flex min-w-0 flex-col gap-6">
						{plan.itinerary ? (
							<ItineraryCard itinerary={plan.itinerary} />
						) : (
							<Card className="min-w-0">
								<CardHeader>
									<CardTitle>Itinerary</CardTitle>
									<CardDescription>
										Ask the agent to rank stops and write a day-by-day plan.
									</CardDescription>
								</CardHeader>
								<CardPanel>
									<CardPanelEmpty>
										No itinerary yet. Open the chat below to start planning.
									</CardPanelEmpty>
								</CardPanel>
							</Card>
						)}

						<Card className="min-w-0">
							<CardHeader>
								<CardTitle>Plan with the agent</CardTitle>
								<CardDescription>
									Search nearby accounts, set the day order, then finalize for
									PDF.
								</CardDescription>
							</CardHeader>
							<CardPanel className="h-[min(36rem,70vh)]">
								<TripAgentPanel key={trip} tripPlanId={trip} />
							</CardPanel>
						</Card>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-sm">
					{formatCount(rows.length, "trip")}
				</p>
				<Button type="button" size="sm" onClick={startNew}>
					<Icon icon={Add} data-icon="inline-start" />
					New trip
				</Button>
			</div>

			{list.isLoading ? (
				<div className="flex flex-1 items-center justify-center py-16">
					<Spinner />
				</div>
			) : rows.length === 0 ? (
				<Empty className="flex-1" width="wide">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Icon icon={Plane} />
						</EmptyMedia>
						<EmptyTitle>No trips yet</EmptyTitle>
						<EmptyDescription>
							Set a hub city, pick must-visit clients, and let the agent build
							a day-by-day route you can download as a PDF.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button type="button" onClick={startNew}>
							<Icon icon={Add} data-icon="inline-start" />
							New trip
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>Your trips</CardTitle>
						<CardDescription>
							Open a draft to keep planning, or a planned trip to export the
							PDF.
						</CardDescription>
					</CardHeader>
					<CardPanel className="h-auto max-h-[min(40rem,70vh)]">
						<ul className="flex flex-col">
							{rows.map((row) => (
								<li key={row.id} className="border-b last:border-b-0">
									<button
										type="button"
										className={cn(
											"hover:bg-muted/60 flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors",
										)}
										onClick={() => openTrip(row.id)}
									>
										<span className="flex min-w-0 flex-col gap-1">
											<span className="truncate text-sm font-medium">
												{row.hubCity}, {row.hubStateCode}
											</span>
											<span className="text-muted-foreground text-xs">
												{tripMeta(row)}
											</span>
										</span>
										<span className="flex shrink-0 flex-col items-end gap-1">
											<StatusIndicator
												tone={statusTone(row.status)}
												label={statusLabel(row.status)}
											/>
											<span className="text-muted-foreground text-xs">
												{relativeTimeFromIso(row.updatedAt)}
											</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					</CardPanel>
				</Card>
			)}
		</div>
	);
}

function ItineraryCard({
	itinerary,
}: {
	itinerary: NonNullable<TripPlan["itinerary"]>;
}) {
	const stopTotal = itinerary.days.reduce(
		(sum, day) => sum + day.stops.length,
		0,
	);

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Itinerary</CardTitle>
				<CardDescription>
					{formatCount(itinerary.days.length, "day")} ·{" "}
					{formatCount(stopTotal, "stop")}
				</CardDescription>
			</CardHeader>
			<CardContent className="gap-5">
				{itinerary.summary ? (
					<p className="text-muted-foreground text-sm">{itinerary.summary}</p>
				) : null}
				<div className="flex flex-col gap-5">
					{itinerary.days.map((day) => (
						<div key={day.day} className="flex flex-col gap-2">
							<div className="flex items-baseline justify-between gap-2">
								<div className="text-sm font-medium">
									Day {day.day}
									{day.label ? ` — ${day.label}` : ""}
								</div>
								<div className="text-muted-foreground text-xs">
									{formatCount(day.stops.length, "stop")}
								</div>
							</div>
							<ol className="flex flex-col gap-2">
								{day.stops.map((stop, index) => (
									<li
										key={`${day.day}-${stop.companyId}`}
										className="flex gap-3 text-sm"
									>
										<span className="text-muted-foreground w-4 shrink-0 tabular-nums">
											{index + 1}.
										</span>
										<span className="flex min-w-0 flex-col gap-0.5">
											<span className="font-medium">{stop.companyName}</span>
											<span className="text-muted-foreground text-xs">
												{[
													[stop.city, stop.stateCode].filter(Boolean).join(", "),
													stop.milesFromHub != null
														? `${Math.round(stop.milesFromHub)} mi`
														: null,
													stop.sage100CustomerNo
														? `#${stop.sage100CustomerNo}`
														: null,
												]
													.filter(Boolean)
													.join(" · ") || "—"}
											</span>
											{stop.notes ? (
												<span className="text-muted-foreground text-xs">
													{stop.notes}
												</span>
											) : null}
										</span>
									</li>
								))}
							</ol>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function TripBriefForm({
	initial,
	hubLatitude,
	hubLongitude,
	error,
	saving,
	isNew,
	compact = false,
	onSave,
	onCancel,
}: {
	initial: FormState;
	hubLatitude?: number;
	hubLongitude?: number;
	error: string | null;
	saving: boolean;
	isNew: boolean;
	compact?: boolean;
	onSave: (form: FormState) => void;
	onCancel?: () => void;
}) {
	const [form, setForm] = useState(initial);
	const hubCityId = useId();
	const hubStateId = useId();
	const dayCountId = useId();
	const radiusId = useId();
	const yearsId = useId();
	const maxVisitsId = useId();
	const notesId = useId();

	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>{isNew ? "New trip" : "Trip brief"}</CardTitle>
				<CardDescription>
					{isNew
						? "Hub city, days, and who you must see — then the agent fills the route."
						: "Update the brief anytime. The agent reads these fields on each turn."}
				</CardDescription>
			</CardHeader>
			<form
				id={isNew ? "trip-brief-new" : "trip-brief-edit"}
				onSubmit={(event) => {
					event.preventDefault();
					onSave(form);
				}}
			>
				<CardContent>
					<FieldGroup>
						<FieldSet>
							<FieldLegend>Hub</FieldLegend>
							<div className="grid grid-cols-[1fr_5.5rem] gap-3">
								<Field>
									<FieldLabel htmlFor={hubCityId}>City</FieldLabel>
									<Input
										id={hubCityId}
										value={form.hubCity}
										onChange={(e) =>
											setForm((f) => ({ ...f, hubCity: e.target.value }))
										}
										placeholder="Chicago"
										autoComplete="address-level2"
										required
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor={hubStateId}>State</FieldLabel>
									<Input
										id={hubStateId}
										value={form.hubStateCode}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												hubStateCode: e.target.value.toUpperCase().slice(0, 2),
											}))
										}
										placeholder="IL"
										maxLength={2}
										autoComplete="address-level1"
										required
									/>
								</Field>
							</div>
							<FieldDescription>
								We geocode the hub when you save so nearby accounts can be
								ranked by distance.
							</FieldDescription>
						</FieldSet>

						<FieldSeparator />

						<FieldSet>
							<FieldLegend>Schedule</FieldLegend>
							<div className="grid grid-cols-2 gap-3">
								<Field>
									<FieldLabel htmlFor={dayCountId}>Days</FieldLabel>
									<Input
										id={dayCountId}
										type="number"
										min={1}
										max={30}
										value={form.dayCount}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												dayCount: Number(e.target.value) || 1,
											}))
										}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor={radiusId}>Radius</FieldLabel>
									<InputGroup>
										<InputGroupInput
											id={radiusId}
											type="number"
											min={25}
											max={500}
											value={form.radiusMiles}
											onChange={(e) =>
												setForm((f) => ({
													...f,
													radiusMiles: Number(e.target.value) || 200,
												}))
											}
										/>
										<InputGroupAddon align="inline-end">
											<InputGroupText>mi</InputGroupText>
										</InputGroupAddon>
									</InputGroup>
								</Field>
							</div>
							<Field>
								<FieldLabel htmlFor={maxVisitsId}>Max visits / day</FieldLabel>
								<Input
									id={maxVisitsId}
									type="number"
									min={1}
									max={20}
									value={form.maxVisitsPerDay}
									onChange={(e) =>
										setForm((f) => ({
											...f,
											maxVisitsPerDay: e.target.value,
										}))
									}
									placeholder="Optional — e.g. 4"
								/>
							</Field>
						</FieldSet>

						<FieldSeparator />

						<FieldSet>
							<FieldLegend>Accounts</FieldLegend>
							<Field>
								<FieldLabel>Activity mode</FieldLabel>
								<ToggleGroup
									type="single"
									variant="outline"
									size="sm"
									spacing={0}
									value={form.activityMode}
									onValueChange={(value) => {
										if (value === "ACTIVE" || value === "SALVAGE") {
											setForm((f) => ({ ...f, activityMode: value }));
										}
									}}
									aria-label="Activity mode"
									className="w-full"
								>
									<ToggleGroupItem value="ACTIVE" className="flex-1">
										Active
									</ToggleGroupItem>
									<ToggleGroupItem value="SALVAGE" className="flex-1">
										Salvage
									</ToggleGroupItem>
								</ToggleGroup>
								<FieldDescription>
									{form.activityMode === "ACTIVE"
										? "Companies with a deal created or closed in the window."
										: "Quiet accounts — little or no deal activity in the window."}
								</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor={yearsId}>Look-back years</FieldLabel>
								<Input
									id={yearsId}
									type="number"
									min={1}
									max={20}
									value={form.activityYears}
									onChange={(e) =>
										setForm((f) => ({
											...f,
											activityYears: Number(e.target.value) || 3,
										}))
									}
								/>
							</Field>
							<Field>
								<FieldLabel>Must-visit clients</FieldLabel>
								<CompanyMultiPicker
									value={form.mustVisitCompanyIds}
									onChange={(ids) =>
										setForm((f) => ({ ...f, mustVisitCompanyIds: ids }))
									}
									hubLatitude={hubLatitude}
									hubLongitude={hubLongitude}
									radiusMiles={form.radiusMiles}
								/>
								<FieldDescription>
									Always included, even outside the radius. Prefer nearby once
									the hub is saved.
								</FieldDescription>
							</Field>
						</FieldSet>

						<FieldSeparator />

						<Field>
							<FieldLabel htmlFor={notesId}>Notes</FieldLabel>
							<Textarea
								id={notesId}
								value={form.notes}
								onChange={(e) =>
									setForm((f) => ({ ...f, notes: e.target.value }))
								}
								placeholder="Hotel near downtown, focus on OEMs…"
								rows={compact ? 2 : 3}
							/>
						</Field>

						{error ? <FieldError>{error}</FieldError> : null}

						<div className="flex flex-wrap gap-2 pt-1">
							<Button type="submit" disabled={saving}>
								{saving ? <Spinner data-icon="inline-start" /> : null}
								{saving ? "Saving…" : isNew ? "Create trip" : "Save brief"}
							</Button>
							{isNew && onCancel ? (
								<Button
									type="button"
									variant="outline"
									onClick={onCancel}
									disabled={saving}
								>
									Cancel
								</Button>
							) : null}
						</div>
					</FieldGroup>
				</CardContent>
			</form>
		</Card>
	);
}
