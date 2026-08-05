import type { Db } from "@crm/db";
import {
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { ContactsService } from "../contacts/contacts.service";
import { InjectDatabase } from "../database/database.constants";
import { splitName } from "../google/participants";
import type {
	ScreeningClaimInput,
	ScreeningDecideInput,
} from "./screening.contracts";

export type ScreeningMailRow = {
	source: "mail";
	id: string;
	email: string;
	displayName: string | null;
	domain: string;
	direction: string;
	sampleSubject: string | null;
	messageCount: number;
	companyName: null;
	phone: null;
	locationText: null;
	connectLocation: null;
	comments: null;
	assignedLabel: null;
	claimable: false;
	firstSeenAt: string;
	lastSeenAt: string;
};

export type ScreeningWebRow = {
	source: "web";
	id: string;
	email: string;
	displayName: string | null;
	domain: string;
	direction: "INBOUND";
	sampleSubject: string | null;
	messageCount: 1;
	companyName: string | null;
	phone: string | null;
	locationText: string | null;
	connectLocation: string | null;
	comments: string | null;
	assignedLabel: string | null;
	claimable: boolean;
	firstSeenAt: string;
	lastSeenAt: string;
};

export type ScreeningRow = ScreeningMailRow | ScreeningWebRow;

/**
 * Screening Room — review queue for unmatched mail + website form leads.
 *
 * Mail rows are per-rep (`PendingContact`). Web rows are territory-assigned or
 * shared (null assignee) until claimed. Approve creates contacts via
 * `ContactsService.createFromScreening`.
 */
@Injectable()
export class ScreeningService {
	private readonly logger = new Logger(ScreeningService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly contacts: ContactsService,
	) {}

	/** Merged PENDING mail (mine) + web (mine or unassigned), newest first. */
	async list(userId: string) {
		const [mailRows, webRows] = await Promise.all([
			this.db.pendingContact.findMany({
				where: { userId, status: "PENDING" },
			}),
			this.db.pendingWebLead.findMany({
				where: {
					status: "PENDING",
					OR: [{ assignedUserId: userId }, { assignedUserId: null }],
				},
				include: {
					assignedUser: { select: { id: true, name: true } },
				},
			}),
		]);

		const mail: ScreeningMailRow[] = mailRows.map((row) => ({
			source: "mail" as const,
			id: row.id,
			email: row.email,
			displayName: row.displayName,
			domain: row.domain,
			direction: row.direction,
			sampleSubject: row.sampleSubject,
			messageCount: row.messageCount,
			companyName: null,
			phone: null,
			locationText: null,
			connectLocation: null,
			comments: null,
			assignedLabel: null,
			claimable: false,
			firstSeenAt: row.firstSeenAt.toISOString(),
			lastSeenAt: row.lastSeenAt.toISOString(),
		}));

		const web: ScreeningWebRow[] = webRows.map((row) => {
			const claimable = row.assignedUserId === null;
			let assignedLabel: string | null = null;
			if (claimable) {
				assignedLabel = "Unassigned";
			} else if (row.assignedUserId === userId) {
				assignedLabel = "You";
			} else if (row.assignedUser?.name) {
				assignedLabel = row.assignedUser.name;
			}

			return {
				source: "web" as const,
				id: row.id,
				email: row.email,
				displayName: row.displayName,
				domain: row.domain,
				direction: "INBOUND" as const,
				sampleSubject: row.sampleSubject,
				messageCount: 1 as const,
				companyName: row.companyName,
				phone: row.phone,
				locationText: row.locationText,
				connectLocation: row.connectLocation,
				comments: row.comments,
				assignedLabel,
				claimable,
				firstSeenAt: row.receivedAt.toISOString(),
				lastSeenAt: row.receivedAt.toISOString(),
			};
		});

		const rows = [...mail, ...web].toSorted(
			(a, b) =>
				new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
		);

		return { rows };
	}

	/** Mail PENDING for me + web assigned to me + unassigned web. */
	async count(userId: string) {
		const [mailCount, webCount] = await Promise.all([
			this.db.pendingContact.count({
				where: { userId, status: "PENDING" },
			}),
			this.db.pendingWebLead.count({
				where: {
					status: "PENDING",
					OR: [{ assignedUserId: userId }, { assignedUserId: null }],
				},
			}),
		]);
		return { count: mailCount + webCount };
	}

	async claim(input: ScreeningClaimInput, userId: string) {
		const updated = await this.db.pendingWebLead.updateMany({
			where: {
				id: input.id,
				status: "PENDING",
				assignedUserId: null,
			},
			data: {
				assignedUserId: userId,
				claimedById: userId,
				claimedAt: new Date(),
			},
		});

		if (updated.count === 0) {
			const row = await this.db.pendingWebLead.findUnique({
				where: { id: input.id },
				select: { id: true, status: true, assignedUserId: true },
			});
			if (row?.status !== "PENDING") {
				throw new NotFoundException(`No pending web lead with id ${input.id}.`);
			}
			throw new ConflictException("That lead was already claimed.");
		}

		return { ok: true as const };
	}

	async decide(input: ScreeningDecideInput, decidedById: string) {
		if (input.source === "web") {
			return this.decideWeb(input, decidedById);
		}
		return this.decideMail(input, decidedById);
	}

	private async decideMail(input: ScreeningDecideInput, decidedById: string) {
		const row = await this.db.pendingContact.findUnique({
			where: { id: input.id },
		});

		if (!row || row.userId !== decidedById) {
			throw new NotFoundException(`No pending contact with id ${input.id}.`);
		}

		if (row.status !== "PENDING") {
			throw new NotFoundException(
				`That candidate was already ${row.status.toLowerCase()}.`,
			);
		}

		if (input.decision === "approve") {
			return this.approveMail(row, input, decidedById);
		}

		return this.rejectMail(row, input, decidedById);
	}

	private async decideWeb(input: ScreeningDecideInput, decidedById: string) {
		const row = await this.db.pendingWebLead.findUnique({
			where: { id: input.id },
		});

		if (row?.status !== "PENDING") {
			throw new NotFoundException(`No pending web lead with id ${input.id}.`);
		}

		// Must be assigned to me, or still unassigned (claim + decide in one step).
		if (row.assignedUserId && row.assignedUserId !== decidedById) {
			throw new NotFoundException(`No pending web lead with id ${input.id}.`);
		}

		if (input.decision === "approve") {
			return this.approveWeb(row, input, decidedById);
		}

		return this.rejectWeb(row, input, decidedById);
	}

	private async approveMail(
		row: {
			id: string;
			email: string;
			displayName: string | null;
			domain: string;
		},
		input: ScreeningDecideInput,
		decidedById: string,
	) {
		const fromName = splitName(row.displayName, row.email);
		const firstName =
			input.createContact?.firstName?.trim() || fromName.firstName;
		const lastName =
			input.createContact?.lastName !== undefined
				? input.createContact.lastName.trim() || null
				: fromName.lastName;

		const contact = await this.contacts.createFromScreening({
			firstName,
			lastName: lastName ?? undefined,
			email: row.email,
			companyId: input.createContact?.companyId,
			preferDomainCompany: input.createContact?.preferDomainCompany,
			ownerId: decidedById,
		});

		await this.db.pendingContact.update({
			where: { id: row.id },
			data: {
				status: "APPROVED",
				decidedById,
				decidedAt: new Date(),
			},
		});

		this.logger.log({
			message: "Pending contact approved",
			pendingId: row.id,
			contactId: contact.id,
			email: row.email,
			sagePushQueued: contact.sagePushQueued,
		});

		return {
			decision: "approve" as const,
			contactId: contact.id,
			sagePushQueued: contact.sagePushQueued,
		};
	}

	private async approveWeb(
		row: {
			id: string;
			email: string;
			displayName: string | null;
			phone: string | null;
			assignedUserId: string | null;
		},
		input: ScreeningDecideInput,
		decidedById: string,
	) {
		const fromName = splitName(row.displayName, row.email);
		const firstName =
			input.createContact?.firstName?.trim() || fromName.firstName;
		const lastName =
			input.createContact?.lastName !== undefined
				? input.createContact.lastName.trim() || null
				: fromName.lastName;

		const contact = await this.contacts.createFromScreening({
			firstName,
			lastName: lastName ?? undefined,
			email: row.email,
			phone: row.phone ?? undefined,
			companyId: input.createContact?.companyId,
			preferDomainCompany: input.createContact?.preferDomainCompany,
			ownerId: decidedById,
		});

		await this.db.pendingWebLead.update({
			where: { id: row.id },
			data: {
				status: "APPROVED",
				assignedUserId: decidedById,
				claimedById: row.assignedUserId ? undefined : decidedById,
				claimedAt: row.assignedUserId ? undefined : new Date(),
				decidedById,
				decidedAt: new Date(),
			},
		});

		this.logger.log({
			message: "Pending web lead approved",
			pendingId: row.id,
			contactId: contact.id,
			email: row.email,
			sagePushQueued: contact.sagePushQueued,
		});

		return {
			decision: "approve" as const,
			contactId: contact.id,
			sagePushQueued: contact.sagePushQueued,
		};
	}

	private async rejectMail(
		row: { id: string; email: string; domain: string },
		input: ScreeningDecideInput,
		decidedById: string,
	) {
		await this.db.pendingContact.update({
			where: { id: row.id },
			data: {
				status: "REJECTED",
				decidedById,
				decidedAt: new Date(),
			},
		});

		if (input.suppressDomain) {
			await this.db.suppressedDomain.upsert({
				where: { domain: row.domain },
				create: {
					domain: row.domain,
					reason: "Rejected in Screening Room",
				},
				update: {},
			});
		}

		this.logger.log({
			message: "Pending contact rejected",
			pendingId: row.id,
			email: row.email,
			suppressDomain: Boolean(input.suppressDomain),
		});

		return { decision: "reject" as const, contactId: null };
	}

	private async rejectWeb(
		row: {
			id: string;
			email: string;
			domain: string;
			assignedUserId: string | null;
		},
		input: ScreeningDecideInput,
		decidedById: string,
	) {
		await this.db.pendingWebLead.update({
			where: { id: row.id },
			data: {
				status: "REJECTED",
				assignedUserId: decidedById,
				claimedById: row.assignedUserId ? undefined : decidedById,
				claimedAt: row.assignedUserId ? undefined : new Date(),
				decidedById,
				decidedAt: new Date(),
			},
		});

		if (input.suppressDomain) {
			await this.db.suppressedDomain.upsert({
				where: { domain: row.domain },
				create: {
					domain: row.domain,
					reason: "Rejected in Screening Room",
				},
				update: {},
			});
		}

		this.logger.log({
			message: "Pending web lead rejected",
			pendingId: row.id,
			email: row.email,
			suppressDomain: Boolean(input.suppressDomain),
		});

		return { decision: "reject" as const, contactId: null };
	}
}
