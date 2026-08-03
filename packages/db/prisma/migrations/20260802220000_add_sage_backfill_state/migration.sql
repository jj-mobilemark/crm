-- Sage full-pull backfill state + soft-deactivate/push echo-guard columns.
-- All additive and nullable (phase has a default), so this is safe to deploy
-- ahead of the 7.4b backfill code. See docs/plans/sage-crm-sync.md section 6.

-- AlterTable
ALTER TABLE "sageSyncState" ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'backfill',
ADD COLUMN     "backfillId" TEXT,
ADD COLUMN     "highWaterUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "processed" INTEGER,
ADD COLUMN     "backfillDoneAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "sageDeactivatedAt" TIMESTAMP(3),
ADD COLUMN     "sagePushedAt" TIMESTAMP(3),
ADD COLUMN     "sageUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "sageDeactivatedAt" TIMESTAMP(3),
ADD COLUMN     "sagePushedAt" TIMESTAMP(3),
ADD COLUMN     "sageUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "sageDeactivatedAt" TIMESTAMP(3),
ADD COLUMN     "sagePushedAt" TIMESTAMP(3),
ADD COLUMN     "sageUpdatedAt" TIMESTAMP(3);
