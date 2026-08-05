import { Module } from "@nestjs/common";
import { MicrosoftModule } from "../microsoft/microsoft.module";
import { DailyTaskPushService } from "./daily-task-push.service";
import { NotificationsController } from "./notifications.controller";

/**
 * Mechanical notification jobs (daily task email, etc.).
 *
 * Imports `MicrosoftModule` for Graph send + token refresh. Intelligence stays
 * out of Nest — this only lists open tasks and posts `/me/sendMail`.
 */
@Module({
	imports: [MicrosoftModule],
	controllers: [NotificationsController],
	providers: [DailyTaskPushService],
})
export class NotificationsModule {}
