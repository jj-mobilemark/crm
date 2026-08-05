-- AlterTable
ALTER TABLE "user" ADD COLUMN "dailyTaskPush" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "dailyTaskPushLastSentOn" TEXT;
