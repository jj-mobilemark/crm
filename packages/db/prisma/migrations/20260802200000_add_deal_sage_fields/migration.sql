-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "sageCrmOpportunityId" TEXT,
ADD COLUMN     "probability" INTEGER,
ADD COLUMN     "weightedAmount" DECIMAL(14,2),
ADD COLUMN     "dealType" TEXT,
ADD COLUMN     "sageStage" TEXT,
ADD COLUMN     "sageStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "deal_sageCrmOpportunityId_key" ON "deal"("sageCrmOpportunityId");
