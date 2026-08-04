import type { Db } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ContactsService } from "../contacts/contacts.service";
import { InjectDatabase } from "../database/database.constants";
import { splitName } from "../google/participants";
import type { ScreeningDecideInput } from "./screening.contracts";

/**
 * Screening Room — review queue for unmatched external correspondents.
 *
 * Per-rep: each candidate belongs to the mailbox that harvested it. Nest only
 * stores metadata and creates contacts on approve. Identity research still
 * goes through `ContactsService.createFromScreening` → `contactCreated`.
 */
@Injectable()
export class ScreeningService {
	private readonly logger = new Logger(ScreeningService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly contacts: ContactsService,
	) {}

	/** This rep's PENDING candidates, ranked by how often they have been seen. */
	async list(userId: string) {
		const rows = await this.db.pendingContact.findMany({
			where: { userId, status: "PENDING" },
			orderBy: [{ messageCount: "desc" }, { lastSeenAt: "desc" }],
		});

		return {
			rows: rows.map((row) => ({
				id: row.id,
				email: row.email,
				displayName: row.displayName,
				domain: row.domain,
				direction: row.direction,
				sampleSubject: row.sampleSubject,
				messageCount: row.messageCount,
				firstSeenAt: row.firstSeenAt.toISOString(),
				lastSeenAt: row.lastSeenAt.toISOString(),
			})),
		};
	}

	async decide(input: ScreeningDecideInput, decidedById: string) {
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
			return this.approve(row, input, decidedById);
		}

		return this.reject(row, input, decidedById);
	}

	private async approve(
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

	private async reject(
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
}
