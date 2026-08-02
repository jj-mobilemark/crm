-- CreateTable
CREATE TABLE "pendingContact" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "domain" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sampleSubject" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "pendingContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pendingContact_email_key" ON "pendingContact"("email");

-- CreateIndex
CREATE INDEX "pendingContact_status_lastSeenAt_idx" ON "pendingContact"("status", "lastSeenAt");
