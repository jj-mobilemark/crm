"use client";

import Add from "@carbon/icons-react/es/Add";
import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

const UNASSIGNED = "unassigned";

type SimilarMatch =
	RouterOutputs["companies"]["similar"]["matches"][number];

/**
 * Name, domain, owner — nothing else.
 *
 * Everything a form could ask for next (industry, address, logo, socials) is
 * something the agent can find from the domain, and a form that asks a rep to
 * type it is a form they will skip.
 *
 * Before create, we soft-match local companies (name / domain). Domain hits
 * block create; name hits ask the rep to use the existing row or confirm a new
 * one — so two reps do not fork the same Sage company by accident.
 */
export function CreateCompanySheet() {
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();

	// Open state lives in the URL, like every other view state here: "add a
	// company" is then a link you can send someone, and Back closes the sheet
	// instead of leaving the page. Shallow, so it costs no server round trip.
	const [open, setOpen] = useQueryState(
		"new",
		parseAsBoolean.withDefault(false),
	);
	const [name, setName] = useState("");
	const [domain, setDomain] = useState("");
	const [ownerId, setOwnerId] = useState(UNASSIGNED);
	const [checking, setChecking] = useState(false);
	const [matches, setMatches] = useState<SimilarMatch[] | null>(null);

	const nameId = useId();
	const domainId = useId();

	const users = useQuery(trpc.users.list.queryOptions());

	const create = useMutation(
		trpc.companies.create.mutationOptions({
			onSuccess: async (company) => {
				await cache.company(company.id);
				toast.success(`${company.name} added.`);
				// `null` rather than `false` so the closed state leaves a clean URL.
				await setOpen(null);
				resetForm();
				openRecord({ kind: "company", id: company.id });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function resetForm() {
		setName("");
		setDomain("");
		setOwnerId(UNASSIGNED);
		setMatches(null);
	}

	function createPayload() {
		return {
			name,
			domain: domain || undefined,
			ownerId: ownerId === UNASSIGNED ? null : ownerId,
		};
	}

	async function checkThenCreate() {
		setChecking(true);
		try {
			const result = await queryClient.fetchQuery(
				trpc.companies.similar.queryOptions({
					name,
					domain: domain || undefined,
				}),
			);
			if (result.matches.length > 0) {
				setMatches([...result.matches]);
				return;
			}
			create.mutate(createPayload());
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not check for matches.",
			);
		} finally {
			setChecking(false);
		}
	}

	function useExisting(companyId: string) {
		setMatches(null);
		void setOpen(null);
		resetForm();
		openRecord({ kind: "company", id: companyId });
	}

	function createAnyway() {
		setMatches(null);
		create.mutate(createPayload());
	}

	const busy = create.isPending || checking;
	const domainBlocks = Boolean(matches?.some((row) => row.blocksCreate));

	return (
		<>
			<Sheet open={open} onOpenChange={(next) => setOpen(next || null)}>
				<SheetTrigger asChild>
					<Button>
						<Icon icon={Add} data-icon="inline-start" />
						New company
					</Button>
				</SheetTrigger>
				<SheetContent side="right">
					<SheetHeader>
						<SheetTitle>New company</SheetTitle>
						<SheetDescription>
							Give it a name and a domain. The agent fills in the logo,
							description, industry, address and socials.
						</SheetDescription>
					</SheetHeader>

					<form
						id="create-company"
						className="flex-1 overflow-y-auto px-4"
						onSubmit={(event) => {
							event.preventDefault();
							void checkThenCreate();
						}}
					>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={nameId}>Name</FieldLabel>
								<Input
									id={nameId}
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="Stripe"
									autoComplete="off"
									required
								/>
							</Field>

							<Field>
								<FieldLabel htmlFor={domainId}>Domain</FieldLabel>
								<Input
									id={domainId}
									value={domain}
									onChange={(event) => setDomain(event.target.value)}
									placeholder="stripe.com"
									autoComplete="off"
									inputMode="url"
								/>
								<FieldDescription>
									A full URL is fine — it is reduced to the bare host, which has
									to be unique.
								</FieldDescription>
							</Field>

							<Field>
								<FieldLabel htmlFor="create-company-owner">Owner</FieldLabel>
								<Select value={ownerId} onValueChange={setOwnerId}>
									<SelectTrigger id="create-company-owner">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
										{(users.data ?? []).map((user) => (
											<SelectItem key={user.id} value={user.id}>
												{user.name}
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
							form="create-company"
							disabled={busy || name.trim() === ""}
						>
							{busy ? <Spinner /> : null}
							Add company
						</Button>
						<SheetClose asChild>
							<Button variant="outline">Cancel</Button>
						</SheetClose>
					</SheetFooter>
				</SheetContent>
			</Sheet>

			<Dialog
				open={matches !== null}
				onOpenChange={(next) => {
					if (!next) setMatches(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{domainBlocks
								? "This company already exists"
								: "Possible matches"}
						</DialogTitle>
						<DialogDescription>
							{domainBlocks
								? "That domain is already on a company. Open the existing record instead of creating a duplicate."
								: "A similar company is already in the CRM (including Sage imports). Use an existing one, or create a new company if these are different."}
						</DialogDescription>
					</DialogHeader>

					<ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
						{(matches ?? []).map((match) => (
							<li
								key={match.id}
								className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
							>
								<span className="flex min-w-0 flex-col">
									<span className="truncate font-medium">{match.name}</span>
									<span className="truncate text-muted-foreground text-xs">
										{[
											match.domain,
											[match.city, match.stateCode].filter(Boolean).join(", "),
											match.sageCrmCompanyId
												? `Sage ${match.sageCrmCompanyId}`
												: null,
											match.reason === "domain" ? "Same domain" : "Similar name",
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => useExisting(match.id)}
								>
									Use this
								</Button>
							</li>
						))}
					</ul>

					<DialogFooter>
						{domainBlocks ? null : (
							<Button
								type="button"
								disabled={create.isPending}
								onClick={createAnyway}
							>
								{create.isPending ? <Spinner /> : null}
								Create new anyway
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={() => setMatches(null)}
						>
							Back
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
