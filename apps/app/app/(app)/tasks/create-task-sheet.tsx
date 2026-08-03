"use client";

import Add from "@carbon/icons-react/es/Add";
import { Button } from "@crm/ui/components/button";
import { DatePicker } from "@crm/ui/components/date-picker";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { CompanyPicker } from "@/components/crm/company-picker";
import {
	PRIORITY_NONE,
	PRIORITY_OPTIONS,
	type PriorityValue,
} from "@/components/crm/priority";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const UNSET = "none";

/**
 * Global "New task" entry. A task still has to attach to a company (and
 * optionally a deal on that company) — the composer on a record sheet already
 * knows its anchor; this sheet asks for one.
 */
export function CreateTaskSheet() {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [open, setOpen] = useQueryState(
		"new",
		parseAsBoolean.withDefault(false),
	);
	const [subject, setSubject] = useState("");
	const [companyId, setCompanyId] = useState<string | null>(null);
	const [dealId, setDealId] = useState(UNSET);
	const [dueAt, setDueAt] = useState("");
	const [priority, setPriority] = useState<string>(PRIORITY_NONE);

	const subjectId = useId();
	const dueAtId = useId();

	const deals = useQuery({
		...trpc.deals.list.queryOptions({
			q: "",
			sort: "name",
			dir: "asc",
			page: 1,
			pageSize: 50,
			status: "open",
			owner: "all",
			stage: "all",
			closing: "all",
			company: companyId ?? "all",
			priority: "all",
		}),
		enabled: Boolean(companyId),
	});

	const create = useMutation(
		trpc.activities.create.mutationOptions({
			onSuccess: async (task) => {
				await cache.activity();
				toast.success("Task added.");
				await setOpen(null);
				setSubject("");
				setCompanyId(null);
				setDealId(UNSET);
				setDueAt("");
				setPriority(PRIORITY_NONE);
				if (task.deal) {
					openRecord({ kind: "deal", id: task.deal.id });
				} else if (task.company) {
					openRecord({ kind: "company", id: task.company.id });
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const ready = subject.trim() !== "" && companyId !== null;

	return (
		<Sheet open={open} onOpenChange={(next) => setOpen(next || null)}>
			<SheetTrigger asChild>
				<Button>
					<Icon icon={Add} data-icon="inline-start" />
					New task
				</Button>
			</SheetTrigger>
			<SheetContent side="right">
				<SheetHeader>
					<SheetTitle>New task</SheetTitle>
					<SheetDescription>
						Every task is about a company. Attach a deal when the work sits on
						one.
					</SheetDescription>
				</SheetHeader>

				<form
					id="create-task"
					className="flex-1 overflow-y-auto px-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!companyId) return;
						create.mutate({
							type: "TASK",
							subject,
							companyId,
							dealId: dealId === UNSET ? undefined : dealId,
							dueAt: dueAt || null,
							priority:
								priority === PRIORITY_NONE ? null : (priority as PriorityValue),
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={subjectId}>Task</FieldLabel>
							<Input
								id={subjectId}
								value={subject}
								onChange={(event) => setSubject(event.target.value)}
								placeholder="Send proposal follow-up"
								autoComplete="off"
								required
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-task-company">Company</FieldLabel>
							<CompanyPicker
								id="create-task-company"
								value={companyId}
								onChange={(id) => {
									setCompanyId(id);
									setDealId(UNSET);
								}}
								placeholder="Choose a company"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-task-deal">Deal</FieldLabel>
							<Select
								value={dealId || UNSET}
								onValueChange={setDealId}
								disabled={!companyId}
							>
								<SelectTrigger id="create-task-deal">
									<SelectValue placeholder="No deal" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={UNSET}>No deal</SelectItem>
									{(deals.data?.rows ?? []).map((deal) => (
										<SelectItem key={deal.id} value={deal.id}>
											{deal.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldDescription>
								Optional. Open deals for the company you picked.
							</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor={dueAtId}>Due date</FieldLabel>
							<DatePicker
								id={dueAtId}
								value={dueAt}
								onChange={setDueAt}
								placeholder="No date yet"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-task-priority">Priority</FieldLabel>
							<Select value={priority} onValueChange={setPriority}>
								<SelectTrigger id="create-task-priority">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PRIORITY_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</FieldGroup>
				</form>

				<SheetFooter>
					<Button
						type="submit"
						form="create-task"
						disabled={create.isPending || !ready}
					>
						{create.isPending ? <Spinner /> : null}
						Add task
					</Button>
					<SheetClose asChild>
						<Button variant="outline">Cancel</Button>
					</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
