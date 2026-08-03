"use client";

import { Button } from "@crm/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	ContactMultiPicker,
	type PickedContact,
} from "@/components/crm/contact-multi-picker";
import { useTRPC } from "@/lib/trpc/client";

type EnrollContactsProps = {
	sequenceId: string;
	onEnrolled: () => Promise<void>;
};

export function EnrollContacts({
	sequenceId,
	onEnrolled,
}: EnrollContactsProps) {
	const trpc = useTRPC();
	const [picked, setPicked] = useState<PickedContact[]>([]);

	const enroll = useMutation(
		trpc.sequences.enroll.mutationOptions({
			onSuccess: async (result) => {
				await onEnrolled();
				setPicked([]);
				const skipped = result.skipped.length;
				toast.success(
					skipped > 0
						? `Enrolled ${result.enrolled.length}; skipped ${skipped}.`
						: `Enrolled ${result.enrolled.length} contact${result.enrolled.length === 1 ? "" : "s"}.`,
				);
				if (skipped > 0) {
					const reasons = result.skipped
						.slice(0, 3)
						.map((s) => s.reason)
						.join(" ");
					toast.message(reasons);
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-3 rounded-md border p-4">
			<ContactMultiPicker value={picked} onChange={setPicked} />
			<Button
				type="button"
				size="sm"
				className="w-fit"
				disabled={picked.length === 0 || enroll.isPending}
				onClick={() =>
					enroll.mutate({
						sequenceId,
						contactIds: picked.map((c) => c.id),
					})
				}
			>
				Enroll {picked.length || ""} contact
				{picked.length === 1 ? "" : "s"}
			</Button>
		</div>
	);
}
