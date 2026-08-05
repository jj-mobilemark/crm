-- Website form leads (Customer Question) + shared mailbox poller cursor.
CREATE TABLE "pendingWebLead" (
    "id" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "domain" TEXT NOT NULL,
    "phone" TEXT,
    "companyName" TEXT,
    "locationText" TEXT,
    "connectLocation" TEXT,
    "comments" TEXT,
    "sampleSubject" TEXT,
    "stateCode" TEXT,
    "countryCode" TEXT,
    "assignedUserId" TEXT,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pendingWebLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pendingWebLead_sourceMessageId_key" ON "pendingWebLead"("sourceMessageId");
CREATE INDEX "pendingWebLead_status_assignedUserId_receivedAt_idx" ON "pendingWebLead"("status", "assignedUserId", "receivedAt");
CREATE INDEX "pendingWebLead_status_email_idx" ON "pendingWebLead"("status", "email");

ALTER TABLE "pendingWebLead" ADD CONSTRAINT "pendingWebLead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pendingWebLead" ADD CONSTRAINT "pendingWebLead_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "webformMailboxSync" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "mailbox" TEXT NOT NULL,
    "cursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webformMailboxSync_pkey" PRIMARY KEY ("id")
);
