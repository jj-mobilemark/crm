-- CreateTable
CREATE TABLE "sageOutbox" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "sageOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sageOutbox_status_nextAttemptAt_idx" ON "sageOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "sageOutbox_entity_localId_idx" ON "sageOutbox"("entity", "localId");
