-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'HIGHEST');

-- AlterTable
ALTER TABLE "deal" ADD COLUMN "priority" "Priority";

-- AlterTable
ALTER TABLE "activity" ADD COLUMN "priority" "Priority";

-- CreateIndex
CREATE INDEX "deal_priority_idx" ON "deal"("priority");

-- CreateIndex
CREATE INDEX "activity_priority_idx" ON "activity"("priority");
