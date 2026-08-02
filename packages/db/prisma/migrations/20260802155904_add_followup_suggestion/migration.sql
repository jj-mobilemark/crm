-- AlterTable
ALTER TABLE "agentTask" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "followUpSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "quote" VARCHAR(300),
    "dueHint" TIMESTAMP(3),
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "activityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "followUpSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "followUpSuggestion_userId_status_createdAt_idx" ON "followUpSuggestion"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "agentTask_userId_idx" ON "agentTask"("userId");
