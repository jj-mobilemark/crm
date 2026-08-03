"use client";

import Add from "@carbon/icons-react/es/Add";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { Switch } from "@crm/ui/components/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HtmlEditor } from "@/components/crm/html-editor";
import { useTRPC } from "@/lib/trpc/client";

type StepDraft = {
	order: number;
	delayMinutes: number;
	subject: string;
	bodyTemplate: string;
};

const DEFAULT_STEP: StepDraft = {
	order: 0,
	delayMinutes: 0,
	subject: "",
	bodyTemplate: "<p>Hi {{firstName}},</p>\n<p></p>",
};

const WEEKDAYS = [
	{ value: 1, label: "Mon" },
	{ value: 2, label: "Tue" },
	{ value: 3, label: "Wed" },
	{ value: 4, label: "Thu" },
	{ value: 5, label: "Fri" },
	{ value: 6, label: "Sat" },
	{ value: 0, label: "Sun" },
];

type SequenceBuilderProps = {
	onDone: (id: string) => void;
	onCancel: () => void;
};

export function SequenceBuilder({ onDone, onCancel }: SequenceBuilderProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [timezone, setTimezone] = useState(
		Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
	);
	const [windowStart, setWindowStart] = useState(9);
	const [windowEnd, setWindowEnd] = useState(17);
	const [sendDays, setSendDays] = useState<number[]>([1, 2, 3, 4, 5]);
	const [stopOnReply, setStopOnReply] = useState(true);
	const [trackingEnabled, setTrackingEnabled] = useState(false);
	const [steps, setSteps] = useState<StepDraft[]>([{ ...DEFAULT_STEP }]);

	const create = useMutation(
		trpc.sequences.create.mutationOptions({
			onSuccess: async (sequence) => {
				await queryClient.invalidateQueries({
					queryKey: trpc.sequences.list.queryKey(),
				});
				toast.success("Sequence created.");
				onDone(sequence.id);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function updateStep(index: number, patch: Partial<StepDraft>) {
		setSteps((prev) =>
			prev.map((step, i) => (i === index ? { ...step, ...patch } : step)),
		);
	}

	function addStep() {
		setSteps((prev) => [
			...prev,
			{
				order: prev.length,
				delayMinutes: 3 * 24 * 60,
				subject: "",
				bodyTemplate: "<p>Hi {{firstName}},</p>\n<p></p>",
			},
		]);
	}

	function removeStep(index: number) {
		setSteps((prev) =>
			prev
				.filter((_, i) => i !== index)
				.map((step, order) => ({ ...step, order })),
		);
	}

	function toggleDay(day: number) {
		setSendDays((prev) =>
			prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
		);
	}

	function handleSubmit() {
		if (!name.trim()) {
			toast.error("Give the sequence a name.");
			return;
		}
		if (steps.length === 0) {
			toast.error("Add at least one step.");
			return;
		}
		if (steps.some((s) => !s.subject.trim() || !s.bodyTemplate.trim())) {
			toast.error("Every step needs a subject and body.");
			return;
		}
		if (sendDays.length === 0) {
			toast.error("Pick at least one send day.");
			return;
		}

		create.mutate({
			name: name.trim(),
			description: description.trim() || null,
			timezone,
			sendWindowStartMinute: windowStart * 60,
			sendWindowEndMinute: windowEnd * 60,
			sendDays,
			stopOnReply,
			trackingEnabled,
			steps: steps.map((step, order) => ({
				order,
				delayMinutes: order === 0 ? 0 : step.delayMinutes,
				subject: step.subject,
				bodyTemplate: step.bodyTemplate,
			})),
		});
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto pb-8">
			<section className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-2 sm:col-span-2">
					<Label htmlFor="seq-name">Name</Label>
					<Input
						id="seq-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="New business intro"
					/>
				</div>
				<div className="flex flex-col gap-2 sm:col-span-2">
					<Label htmlFor="seq-desc">Description</Label>
					<Input
						id="seq-desc"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Optional"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="seq-tz">Timezone</Label>
					<Input
						id="seq-tz"
						value={timezone}
						onChange={(e) => setTimezone(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label>Send window (local hours)</Label>
					<div className="flex items-center gap-2">
						<Input
							type="number"
							min={0}
							max={23}
							value={windowStart}
							onChange={(e) => setWindowStart(Number(e.target.value))}
							aria-label="Window start hour"
						/>
						<span className="text-muted-foreground text-sm">to</span>
						<Input
							type="number"
							min={1}
							max={24}
							value={windowEnd}
							onChange={(e) => setWindowEnd(Number(e.target.value))}
							aria-label="Window end hour"
						/>
					</div>
				</div>
				<div className="flex flex-col gap-2 sm:col-span-2">
					<Label>Send days</Label>
					<div className="flex flex-wrap gap-2">
						{WEEKDAYS.map((day) => {
							const active = sendDays.includes(day.value);
							return (
								<Button
									key={day.value}
									type="button"
									size="sm"
									variant={active ? "default" : "outline"}
									onClick={() => toggleDay(day.value)}
								>
									{day.label}
								</Button>
							);
						})}
					</div>
				</div>
				<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
					<div>
						<p className="text-sm font-medium">Stop on reply</p>
						<p className="text-muted-foreground text-xs">
							End the enrollment when the contact replies.
						</p>
					</div>
					<Switch checked={stopOnReply} onCheckedChange={setStopOnReply} />
				</div>
				<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
					<div>
						<p className="text-sm font-medium">Open / click tracking</p>
						<p className="text-muted-foreground text-xs">
							Off by default — can hurt deliverability for B2B mail.
						</p>
					</div>
					<Switch
						checked={trackingEnabled}
						onCheckedChange={setTrackingEnabled}
					/>
				</div>
			</section>

			<section className="flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<h2 className="font-medium text-sm">Steps</h2>
					<p className="text-muted-foreground text-xs">
						Merge fields: {"{{firstName}}"}, {"{{lastName}}"},{" "}
						{"{{companyName}}"}, {"{{title}}"}, {"{{senderName}}"}
					</p>
				</div>

				{steps.map((step, index) => (
					<div
						key={step.order}
						className="flex flex-col gap-3 rounded-md border p-4"
					>
						<div className="flex items-center justify-between gap-2">
							<p className="font-medium text-sm">Step {index + 1}</p>
							{steps.length > 1 ? (
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label="Remove step"
									onClick={() => removeStep(index)}
								>
									<Icon icon={TrashCan} />
								</Button>
							) : null}
						</div>
						{index > 0 ? (
							<div className="flex flex-col gap-2">
								<Label>Delay after previous step (minutes)</Label>
								<Input
									type="number"
									min={0}
									value={step.delayMinutes}
									onChange={(e) =>
										updateStep(index, {
											delayMinutes: Number(e.target.value),
										})
									}
								/>
								<p className="text-muted-foreground text-xs">
									Tip: 4320 = 3 days, 10080 = 7 days.
								</p>
							</div>
						) : null}
						<div className="flex flex-col gap-2">
							<Label>Subject</Label>
							<Input
								value={step.subject}
								onChange={(e) => updateStep(index, { subject: e.target.value })}
								placeholder="Quick intro"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Body</Label>
							<HtmlEditor
								value={step.bodyTemplate}
								onChange={(html) =>
									updateStep(index, { bodyTemplate: html })
								}
								placeholder="Write the email…"
							/>
						</div>
					</div>
				))}

				<Button type="button" variant="outline" size="sm" onClick={addStep}>
					<Icon icon={Add} />
					Add step
				</Button>
			</section>

			<div className="flex gap-2">
				<Button
					type="button"
					disabled={create.isPending}
					onClick={handleSubmit}
				>
					Create sequence
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={create.isPending}
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}
