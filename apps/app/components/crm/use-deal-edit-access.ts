"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";

/**
 * Deal edit rights for the signed-in user.
 *
 * API enforces the same rules — this only drives UI (hide edit affordances).
 * `isAdmin` comes from `CRM_ADMIN_EMAILS` via `users.me` until real roles land.
 *
 * While `me` is still loading, do not lock the UI (that looked like "I am never
 * an admin" on a cold sheet). Once loaded, owner or admin can edit.
 */
export function useDealEditAccess(ownerId: string | undefined) {
	const trpc = useTRPC();
	const me = useQuery(trpc.users.me.queryOptions());

	const isAdmin = me.data?.isAdmin === true;
	const isOwner = Boolean(me.data?.id && ownerId && me.data.id === ownerId);
	const canEdit = me.isPending ? true : isAdmin || isOwner;
	const canReassign = isAdmin;

	return {
		me: me.data,
		isPending: me.isPending,
		isAdmin,
		isOwner,
		canEdit,
		canReassign,
	};
}
