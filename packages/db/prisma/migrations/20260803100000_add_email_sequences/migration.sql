-- CreateEnum
CREATE TYPE "EmailSequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SequenceEnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED_REPLIED', 'STOPPED_MANUAL', 'UNSUBSCRIBED', 'BOUNCED', 'FAILED', 'NEEDS_RECONNECT');

-- CreateEnum
CREATE TYPE "SequenceStepRunStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "emailSequence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EmailSequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "sendWindowStartMinute" INTEGER NOT NULL DEFAULT 540,
    "sendWindowEndMinute" INTEGER NOT NULL DEFAULT 1020,
    "sendDays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emailSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequenceEnrollment" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "enrolledById" TEXT NOT NULL,
    "status" "SequenceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStepOrder" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leasedUntil" TIMESTAMP(3),
    "threadInternetMessageId" TEXT,
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequenceStepRun" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "SequenceStepRunStatus" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "internetMessageId" TEXT,
    "error" TEXT,
    "trackingToken" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequenceStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequenceUnsubscribe" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequenceUnsubscribe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emailSequence_status_updatedAt_idx" ON "emailSequence"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "sequenceStep_sequenceId_idx" ON "sequenceStep"("sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "sequenceStep_sequenceId_order_key" ON "sequenceStep"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "sequenceEnrollment_status_nextRunAt_idx" ON "sequenceEnrollment"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "sequenceEnrollment_contactId_idx" ON "sequenceEnrollment"("contactId");

-- CreateIndex
CREATE INDEX "sequenceEnrollment_senderUserId_idx" ON "sequenceEnrollment"("senderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "sequenceEnrollment_sequenceId_contactId_key" ON "sequenceEnrollment"("sequenceId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "sequenceStepRun_trackingToken_key" ON "sequenceStepRun"("trackingToken");

-- CreateIndex
CREATE INDEX "sequenceStepRun_enrollmentId_createdAt_idx" ON "sequenceStepRun"("enrollmentId", "createdAt");

-- CreateIndex
CREATE INDEX "sequenceStepRun_stepId_idx" ON "sequenceStepRun"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "sequenceUnsubscribe_email_key" ON "sequenceUnsubscribe"("email");

-- AddForeignKey
ALTER TABLE "emailSequence" ADD CONSTRAINT "emailSequence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceStep" ADD CONSTRAINT "sequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "emailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceEnrollment" ADD CONSTRAINT "sequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "emailSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceEnrollment" ADD CONSTRAINT "sequenceEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceEnrollment" ADD CONSTRAINT "sequenceEnrollment_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceEnrollment" ADD CONSTRAINT "sequenceEnrollment_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceStepRun" ADD CONSTRAINT "sequenceStepRun_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "sequenceEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequenceStepRun" ADD CONSTRAINT "sequenceStepRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "sequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
