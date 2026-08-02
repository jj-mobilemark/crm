-- AlterEnum
ALTER TYPE "RecordSource" ADD VALUE 'SAGE';

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "sageCrmCompanyId" TEXT,
ADD COLUMN     "sage100CustomerNo" TEXT,
ADD COLUMN     "sage100ArDivisionNo" TEXT;

-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "sageCrmContactId" TEXT;

-- CreateTable
CREATE TABLE "sageSyncState" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "status" "GoogleSyncStatus" NOT NULL DEFAULT 'IDLE',
    "cursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "retryAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sageSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sageRecordSnapshot" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "sageId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sageRecordSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_sageCrmCompanyId_key" ON "company"("sageCrmCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_sageCrmContactId_key" ON "contact"("sageCrmContactId");

-- CreateIndex
CREATE UNIQUE INDEX "sageSyncState_entity_key" ON "sageSyncState"("entity");

-- CreateIndex
CREATE UNIQUE INDEX "sageRecordSnapshot_entity_sageId_key" ON "sageRecordSnapshot"("entity", "sageId");
