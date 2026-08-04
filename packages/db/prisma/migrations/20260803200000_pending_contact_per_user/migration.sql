-- Screening was a shared tenant queue; clear polluted rows before scoping
-- each candidate to the mailbox that harvested it.
DELETE FROM "pendingContact";

-- DropIndex
DROP INDEX "pendingContact_email_key";

-- DropIndex
DROP INDEX "pendingContact_status_lastSeenAt_idx";

-- AlterTable
ALTER TABLE "pendingContact" ADD COLUMN "userId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "pendingContact_userId_email_key" ON "pendingContact"("userId", "email");

-- CreateIndex
CREATE INDEX "pendingContact_userId_status_lastSeenAt_idx" ON "pendingContact"("userId", "status", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "pendingContact" ADD CONSTRAINT "pendingContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
