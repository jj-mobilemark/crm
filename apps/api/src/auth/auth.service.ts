import type { Db } from "@crm/db";
import { isCrmAdmin } from "@crm/auth";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Cache } from "cache-manager";
import { InjectDatabase } from "../database/database.constants";

export interface UserProfile {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	/** ISO-8601: a `Date` would come back from Redis as a string anyway. */
	createdAt: string;
	/**
	 * From `CRM_ADMIN_EMAILS` today — leave room for Better Auth roles later
	 * (`docs/crm-plan.md` §6) without changing call sites.
	 */
	isAdmin: boolean;
}

const PROFILE_TTL_MS = 5 * 60_000;

const profileKey = (userId: string) => `auth:profile:${userId}`;

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(CACHE_MANAGER) private readonly cache: Cache,
	) {}

	/**
	 * The session already carries a user, but it is the snapshot taken when the
	 * cookie was minted. Reading the row means a profile change shows up within
	 * the cache TTL instead of at the next sign-in.
	 */
	async getProfile(userId: string): Promise<UserProfile> {
		const key = profileKey(userId);
		const cached = await this.cache.get<UserProfile>(key);

		if (cached) {
			// Recompute admin from env so a list change bites without waiting out
			// the profile TTL (and so old cache entries without `isAdmin` still work).
			return { ...cached, isAdmin: isCrmAdmin(cached.email) };
		}

		this.logger.debug({ message: "Profile cache miss", userId });

		const user = await this.db.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				name: true,
				email: true,
				emailVerified: true,
				image: true,
				createdAt: true,
			},
		});

		if (!user) {
			// A live session pointing at a deleted row: worth a warning, because
			// it means a session outlived its user.
			this.logger.warn({ message: "Session user no longer exists", userId });
			throw new NotFoundException(`No user with id ${userId}.`);
		}

		const profile: UserProfile = {
			...user,
			createdAt: user.createdAt.toISOString(),
			isAdmin: isCrmAdmin(user.email),
		};

		await this.cache.set(key, profile, PROFILE_TTL_MS);

		return profile;
	}

	async invalidateProfile(userId: string): Promise<void> {
		await this.cache.del(profileKey(userId));
		this.logger.debug({ message: "Invalidated cached profile", userId });
	}
}
