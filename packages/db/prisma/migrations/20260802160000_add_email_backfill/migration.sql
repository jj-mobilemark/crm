-- CreateTable
CREATE TABLE "emailBackfill" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "emailBackfill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emailBackfill_status_createdAt_idx" ON "emailBackfill"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "emailBackfill_address_key" ON "emailBackfill"("address");
