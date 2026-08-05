import { auth } from "@crm/auth";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { ActivitiesModule } from "./activities/activities.module";
import { AuthModule } from "./auth/auth.module";
import { AppCacheModule } from "./cache/cache.module";
import { CompaniesModule } from "./companies/companies.module";
import { validateEnv } from "./config/env.validation";
import { ContactsModule } from "./contacts/contacts.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { CrmModule } from "./crm/crm.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DealsModule } from "./deals/deals.module";
import { FollowupsModule } from "./followups/followups.module";
import { GoogleModule } from "./google/google.module";
import { HealthModule } from "./health/health.module";
import { LoggingModule } from "./logging/logging.module";
import { logAuthRoute } from "./logging/request-logger.middleware";
import { MicrosoftModule } from "./microsoft/microsoft.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { SageModule } from "./sage/sage.module";
import { ScreeningModule } from "./screening/screening.module";
import { SearchModule } from "./search/search.module";
import { SequencesModule } from "./sequences/sequences.module";
import { TripPlansModule } from "./trip-plans/trip-plans.module";
import { TrpcModule } from "./trpc/trpc.module";
import { UsersModule } from "./users/users.module";

@Module({
	imports: [
		LoggingModule,
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			validate: validateEnv,
		}),
		AppCacheModule,
		DatabaseModule,
		CrmModule,
		BetterAuthModule.forRoot({ auth, middleware: logAuthRoute }),
		AuthModule,
		HealthModule,
		TrpcModule,
		UsersModule,
		CompaniesModule,
		ContactsModule,
		ConversationsModule,
		DealsModule,
		ActivitiesModule,
		DashboardModule,
		SearchModule,
		GoogleModule,
		MicrosoftModule,
		NotificationsModule,
		SageModule,
		ScreeningModule,
		FollowupsModule,
		SequencesModule,
		TripPlansModule,
	],
})
export class AppModule {}
