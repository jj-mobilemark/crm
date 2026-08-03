-- CreateTable
CREATE TABLE "dealFieldChange" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealFieldChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dealFieldChange_createdAt_idx" ON "dealFieldChange"("createdAt");

-- CreateIndex
CREATE INDEX "dealFieldChange_dealId_createdAt_idx" ON "dealFieldChange"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "dealFieldChange_field_createdAt_idx" ON "dealFieldChange"("field", "createdAt");

-- CreateIndex
CREATE INDEX "dealFieldChange_source_createdAt_idx" ON "dealFieldChange"("source", "createdAt");

-- AddForeignKey
ALTER TABLE "dealFieldChange" ADD CONSTRAINT "dealFieldChange_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealFieldChange" ADD CONSTRAINT "dealFieldChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
