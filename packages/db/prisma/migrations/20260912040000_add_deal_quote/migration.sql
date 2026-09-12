-- CreateEnum
CREATE TYPE "DealQuoteSource" AS ENUM ('SAGE_NOTE', 'SAGE_DESCRIPTION', 'HUMAN', 'PO_TOOL');

-- CreateTable
CREATE TABLE "dealQuote" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "quoteNumber" VARCHAR(11) NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" "DealQuoteSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dealQuote_dealId_quoteNumber_key" ON "dealQuote"("dealId", "quoteNumber");

-- CreateIndex
CREATE INDEX "dealQuote_quoteNumber_idx" ON "dealQuote"("quoteNumber");

-- CreateIndex
CREATE INDEX "dealQuote_dealId_isPrimary_idx" ON "dealQuote"("dealId", "isPrimary");

-- AddForeignKey
ALTER TABLE "dealQuote" ADD CONSTRAINT "dealQuote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
