import { hasMsSendScopes } from "@crm/auth";
import {
	type Db,
	EmailSequenceStatus,
	Prisma,
	SequenceEnrollmentStatus,
} from "@crm/db";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { MICROSOFT_PROVIDER_ID } from "../microsoft/microsoft.constants";
import { parseSendDays } from "./sequence-render";
import type {
	EnrollmentListInput,
	SequenceCreateInput,
	SequenceEnrollInput,
	SequenceReplaceStepsInput,
	SequenceUpdateInput,
} from "./sequences.contracts";

const SEQUENCE_LIST_SELECT = {
	id: true,
	name: true,
	description: true,
	status: true,
	timezone: true,
	sendWindowStartMinute: true,
	sendWindowEndMinute: true,
	sendDays: true,
	stopOnReply: true,
	trackingEnabled: true,
	createdById: true,
	createdAt: true,
	updatedAt: true,
	_count: {
		select: {
			steps: true,
			enrollments: true,
		},
	},
} satisfies Prisma.EmailSequenceSelect;

/**
 * CRUD + enrollment for email sequences.
 *
 * Sending itself lives in `SequenceTickService` — this service only manages
 * the durable rows reps edit in the UI.
 */
@Injectable()
export class SequencesService {
	private readonly logger = new Logger(SequencesService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async list() {
		const rows = await this.db.emailSequence.findMany({
			select: SEQUENCE_LIST_SELECT,
			orderBy: { updatedAt: "desc" },
		});

		const stats = await this.statsBySequence(rows.map((r) => r.id));

		return {
			rows: rows.map((row) => ({
				...row,
				sendDays: parseSendDays(row.sendDays),
				stats: stats.get(row.id) ?? emptyStats(),
			})),
		};
	}

	async byId(id: string) {
		const sequence = await this.db.emailSequence.findUnique({
			where: { id },
			select: {
				...SEQUENCE_LIST_SELECT,
				steps: {
					orderBy: { order: "asc" },
					select: {
						id: true,
						order: true,
						delayMinutes: true,
						subject: true,
						bodyTemplate: true,
					},
				},
			},
		});

		if (!sequence) {
			throw new NotFoundException("Sequence not found.");
		}

		const stats = await this.statsBySequence([id]);

		return {
			...sequence,
			sendDays: parseSendDays(sequence.sendDays),
			stats: stats.get(id) ?? emptyStats(),
		};
	}

	async create(input: SequenceCreateInput, userId: string) {
		const sequence = await this.db.emailSequence.create({
			data: {
				name: input.name.trim(),
				description: input.description?.trim() || null,
				timezone: input.timezone?.trim() || "UTC",
				sendWindowStartMinute: input.sendWindowStartMinute ?? 540,
				sendWindowEndMinute: input.sendWindowEndMinute ?? 1020,
				sendDays: input.sendDays ?? [1, 2, 3, 4, 5],
				stopOnReply: input.stopOnReply ?? true,
				trackingEnabled: input.trackingEnabled ?? false,
				createdById: userId,
				steps: {
					create: input.steps.map((step) => ({
						order: step.order,
						delayMinutes: step.delayMinutes,
						subject: step.subject.trim(),
						bodyTemplate: step.bodyTemplate,
					})),
				},
			},
			select: { id: true },
		});

		this.logger.log({ message: "Sequence created", sequenceId: sequence.id });
		return this.byId(sequence.id);
	}

	async update(input: SequenceUpdateInput) {
		const existing = await this.db.emailSequence.findUnique({
			where: { id: input.id },
			select: { id: true, status: true },
		});
		if (!existing) {
			throw new NotFoundException("Sequence not found.");
		}

		if (
			input.data.status === EmailSequenceStatus.ACTIVE &&
			existing.status !== EmailSequenceStatus.ACTIVE
		) {
			const stepCount = await this.db.sequenceStep.count({
				where: { sequenceId: input.id },
			});
			if (stepCount === 0) {
				throw new BadRequestException(
					"Add at least one step before activating.",
				);
			}
		}

		await this.db.emailSequence.update({
			where: { id: input.id },
			data: {
				...(input.data.name !== undefined
					? { name: input.data.name.trim() }
					: {}),
				...(input.data.description !== undefined
					? { description: input.data.description?.trim() || null }
					: {}),
				...(input.data.status !== undefined
					? { status: input.data.status }
					: {}),
				...(input.data.timezone !== undefined
					? { timezone: input.data.timezone.trim() }
					: {}),
				...(input.data.sendWindowStartMinute !== undefined
					? { sendWindowStartMinute: input.data.sendWindowStartMinute }
					: {}),
				...(input.data.sendWindowEndMinute !== undefined
					? { sendWindowEndMinute: input.data.sendWindowEndMinute }
					: {}),
				...(input.data.sendDays !== undefined
					? { sendDays: input.data.sendDays }
					: {}),
				...(input.data.stopOnReply !== undefined
					? { stopOnReply: input.data.stopOnReply }
					: {}),
				...(input.data.trackingEnabled !== undefined
					? { trackingEnabled: input.data.trackingEnabled }
					: {}),
			},
		});

		return this.byId(input.id);
	}

	async replaceSteps(input: SequenceReplaceStepsInput) {
		const existing = await this.db.emailSequence.findUnique({
			where: { id: input.sequenceId },
			select: { id: true },
		});
		if (!existing) {
			throw new NotFoundException("Sequence not found.");
		}

		await this.db.$transaction(async (tx) => {
			await tx.sequenceStep.deleteMany({
				where: { sequenceId: input.sequenceId },
			});
			await tx.sequenceStep.createMany({
				data: input.steps.map((step) => ({
					sequenceId: input.sequenceId,
					order: step.order,
					delayMinutes: step.delayMinutes,
					subject: step.subject.trim(),
					bodyTemplate: step.bodyTemplate,
				})),
			});
		});

		return this.byId(input.sequenceId);
	}

	/**
	 * Enroll contacts into an ACTIVE sequence. Sender = the calling rep.
	 * Requires Mail.Send on their Microsoft grant.
	 */
	async enroll(input: SequenceEnrollInput, userId: string) {
		await this.requireSendScope(userId);

		const sequence = await this.db.emailSequence.findUnique({
			where: { id: input.sequenceId },
			select: {
				id: true,
				status: true,
				steps: { select: { id: true }, take: 1 },
			},
		});
		if (!sequence) {
			throw new NotFoundException("Sequence not found.");
		}
		if (sequence.status !== EmailSequenceStatus.ACTIVE) {
			throw new BadRequestException(
				"Activate the sequence before enrolling contacts.",
			);
		}
		if (sequence.steps.length === 0) {
			throw new BadRequestException("This sequence has no steps.");
		}

		const contacts = await this.db.contact.findMany({
			where: { id: { in: input.contactIds } },
			select: { id: true, email: true },
		});
		const byId = new Map(contacts.map((c) => [c.id, c]));

		const enrolled: string[] = [];
		const skipped: Array<{ contactId: string; reason: string }> = [];

		for (const contactId of input.contactIds) {
			const contact = byId.get(contactId);
			if (!contact) {
				skipped.push({ contactId, reason: "Contact not found." });
				continue;
			}
			if (!contact.email) {
				skipped.push({ contactId, reason: "Contact has no email." });
				continue;
			}

			const email = contact.email.trim().toLowerCase();
			const unsub = await this.db.sequenceUnsubscribe.findUnique({
				where: { email },
				select: { id: true },
			});
			if (unsub) {
				skipped.push({ contactId, reason: "Address is unsubscribed." });
				continue;
			}

			const activeElsewhere = await this.db.sequenceEnrollment.findFirst({
				where: {
					contactId,
					status: SequenceEnrollmentStatus.ACTIVE,
					sequenceId: { not: input.sequenceId },
				},
				select: { id: true },
			});
			if (activeElsewhere) {
				skipped.push({
					contactId,
					reason: "Contact is already in another active sequence.",
				});
				continue;
			}

			try {
				await this.db.sequenceEnrollment.create({
					data: {
						sequenceId: input.sequenceId,
						contactId,
						senderUserId: userId,
						enrolledById: userId,
						status: SequenceEnrollmentStatus.ACTIVE,
						currentStepOrder: 0,
						nextRunAt: new Date(),
					},
				});
				enrolled.push(contactId);
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					skipped.push({
						contactId,
						reason: "Already enrolled in this sequence.",
					});
					continue;
				}
				throw error;
			}
		}

		this.logger.log({
			message: "Sequence enroll",
			sequenceId: input.sequenceId,
			enrolled: enrolled.length,
			skipped: skipped.length,
		});

		return { enrolled, skipped };
	}

	async listEnrollments(input: EnrollmentListInput) {
		const rows = await this.db.sequenceEnrollment.findMany({
			where: {
				sequenceId: input.sequenceId,
				...(input.status ? { status: input.status } : {}),
			},
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				status: true,
				currentStepOrder: true,
				nextRunAt: true,
				stoppedReason: true,
				createdAt: true,
				contact: {
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						company: { select: { id: true, name: true } },
					},
				},
				runs: {
					orderBy: { createdAt: "desc" },
					take: 5,
					select: {
						id: true,
						status: true,
						sentAt: true,
						openedAt: true,
						clickedAt: true,
						error: true,
						step: { select: { order: true, subject: true } },
					},
				},
			},
		});

		return { rows };
	}

	async pauseEnrollment(id: string) {
		return this.setEnrollmentStatus(id, SequenceEnrollmentStatus.PAUSED);
	}

	async resumeEnrollment(id: string) {
		const row = await this.db.sequenceEnrollment.findUnique({
			where: { id },
			select: {
				id: true,
				status: true,
				sequence: { select: { status: true } },
			},
		});
		if (!row) throw new NotFoundException("Enrollment not found.");
		if (row.sequence.status !== EmailSequenceStatus.ACTIVE) {
			throw new BadRequestException("The sequence is not active.");
		}
		if (row.status !== SequenceEnrollmentStatus.PAUSED) {
			throw new BadRequestException("Only paused enrollments can resume.");
		}

		return this.db.sequenceEnrollment.update({
			where: { id },
			data: {
				status: SequenceEnrollmentStatus.ACTIVE,
				nextRunAt: new Date(),
				stoppedReason: null,
			},
			select: { id: true, status: true, nextRunAt: true },
		});
	}

	async stopEnrollment(id: string) {
		return this.setEnrollmentStatus(
			id,
			SequenceEnrollmentStatus.STOPPED_MANUAL,
			"Stopped by user.",
		);
	}

	/** Whether the rep's Microsoft grant includes Mail.Send. */
	async canSend(userId: string): Promise<boolean> {
		const account = await this.db.account.findFirst({
			where: { userId, providerId: MICROSOFT_PROVIDER_ID },
			select: { scope: true },
		});
		return hasMsSendScopes(account?.scope);
	}

	private async requireSendScope(userId: string) {
		if (!(await this.canSend(userId))) {
			throw new BadRequestException(
				"Grant Outlook Mail.Send access to enroll contacts in a sequence. Reconnect Microsoft from Settings or Grant access.",
			);
		}
	}

	private async setEnrollmentStatus(
		id: string,
		status: SequenceEnrollmentStatus,
		stoppedReason?: string,
	) {
		const row = await this.db.sequenceEnrollment.findUnique({
			where: { id },
			select: { id: true, status: true },
		});
		if (!row) throw new NotFoundException("Enrollment not found.");

		const terminal: SequenceEnrollmentStatus[] = [
			SequenceEnrollmentStatus.COMPLETED,
			SequenceEnrollmentStatus.STOPPED_REPLIED,
			SequenceEnrollmentStatus.STOPPED_MANUAL,
			SequenceEnrollmentStatus.UNSUBSCRIBED,
			SequenceEnrollmentStatus.BOUNCED,
		];
		if (terminal.includes(row.status)) {
			throw new ConflictException(
				`Enrollment is already ${row.status.toLowerCase()}.`,
			);
		}

		return this.db.sequenceEnrollment.update({
			where: { id },
			data: {
				status,
				stoppedReason: stoppedReason ?? null,
				leasedUntil: null,
			},
			select: { id: true, status: true },
		});
	}

	private async statsBySequence(sequenceIds: string[]) {
		const map = new Map<string, ReturnType<typeof emptyStats>>();
		if (sequenceIds.length === 0) return map;

		for (const id of sequenceIds) {
			map.set(id, emptyStats());
		}

		const [enrollmentGroups, runAggs, replied] = await Promise.all([
			this.db.sequenceEnrollment.groupBy({
				by: ["sequenceId", "status"],
				where: { sequenceId: { in: sequenceIds } },
				_count: { _all: true },
			}),
			this.db.sequenceStepRun.groupBy({
				by: ["status"],
				where: {
					enrollment: { sequenceId: { in: sequenceIds } },
				},
				_count: { _all: true },
			}),
			this.db.sequenceEnrollment.groupBy({
				by: ["sequenceId"],
				where: {
					sequenceId: { in: sequenceIds },
					status: SequenceEnrollmentStatus.STOPPED_REPLIED,
				},
				_count: { _all: true },
			}),
		]);

		// Per-sequence run stats need a join — do one query per sequence for clarity
		// at CRM scale (dozens of sequences, not thousands).
		for (const sequenceId of sequenceIds) {
			const stats = map.get(sequenceId) ?? emptyStats();
			const runs = await this.db.sequenceStepRun.findMany({
				where: { enrollment: { sequenceId } },
				select: {
					status: true,
					openedAt: true,
					clickedAt: true,
				},
			});
			for (const run of runs) {
				if (run.status === "SENT") stats.sent += 1;
				if (run.openedAt) stats.opened += 1;
				if (run.clickedAt) stats.clicked += 1;
			}
			map.set(sequenceId, stats);
		}

		for (const row of enrollmentGroups) {
			const stats = map.get(row.sequenceId) ?? emptyStats();
			stats.enrolled += row._count._all;
			if (row.status === SequenceEnrollmentStatus.ACTIVE) {
				stats.active += row._count._all;
			}
			map.set(row.sequenceId, stats);
		}

		for (const row of replied) {
			const stats = map.get(row.sequenceId) ?? emptyStats();
			stats.replied += row._count._all;
			map.set(row.sequenceId, stats);
		}

		void runAggs;
		return map;
	}
}

function emptyStats() {
	return {
		enrolled: 0,
		active: 0,
		sent: 0,
		opened: 0,
		clicked: 0,
		replied: 0,
	};
}
