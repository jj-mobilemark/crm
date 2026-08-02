import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { type Participant, workDomain } from "../google/participants";

/**
 * Upserts unmatched external participants into `PendingContact`.
 *
 * Metadata only — never bodies. Called from Outlook mail sync where a thread
 * would otherwise be dropped. Mechanical: count and last-seen, no judgement.
 */
@Injectable()
export class ScreeningHarvestService {
	private readonly logger = new Logger(ScreeningHarvestService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * Record external participants from a dropped unmatched message.
	 *
	 * Skips decided rows (APPROVED / REJECTED). Existing contacts are already
	 * filtered out by the matcher's `external` list.
	 */
	async harvest(input: {
		external: readonly Participant[];
		direction: "INBOUND" | "OUTBOUND";
		subject: string | null;
		seenAt: Date;
	}): Promise<void> {
		if (input.external.length === 0) return;

		for (const person of input.external) {
			const email = person.email.trim().toLowerCase();
			if (!email) continue;

			const domain = workDomain(email);
			if (!domain) continue;

			const existing = await this.db.pendingContact.findUnique({
				where: { email },
				select: { id: true, status: true },
			});

			if (existing && existing.status !== "PENDING") continue;

			if (existing) {
				await this.db.pendingContact.update({
					where: { email },
					data: {
						messageCount: { increment: 1 },
						lastSeenAt: input.seenAt,
						...(person.name ? { displayName: person.name } : {}),
						...(input.subject ? { sampleSubject: input.subject } : {}),
					},
				});
				continue;
			}

			await this.db.pendingContact.create({
				data: {
					email,
					displayName: person.name,
					domain,
					direction: input.direction,
					sampleSubject: input.subject,
					messageCount: 1,
					firstSeenAt: input.seenAt,
					lastSeenAt: input.seenAt,
					status: "PENDING",
				},
			});

			this.logger.debug({
				message: "Pending contact harvested",
				email,
				domain,
			});
		}
	}
}
