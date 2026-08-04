-- CreateEnum
CREATE TYPE "TripActivityMode" AS ENUM ('ACTIVE', 'SALVAGE');

-- CreateEnum
CREATE TYPE "TripPlanStatus" AS ENUM ('DRAFT', 'PLANNED');

-- CreateTable
CREATE TABLE "tripPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubCity" TEXT NOT NULL,
    "hubStateCode" TEXT NOT NULL,
    "hubLatitude" DOUBLE PRECISION NOT NULL,
    "hubLongitude" DOUBLE PRECISION NOT NULL,
    "hubGeocodePlaceKey" TEXT,
    "dayCount" INTEGER NOT NULL DEFAULT 3,
    "radiusMiles" INTEGER NOT NULL DEFAULT 200,
    "activityMode" "TripActivityMode" NOT NULL DEFAULT 'ACTIVE',
    "activityYears" INTEGER NOT NULL DEFAULT 3,
    "mustVisitCompanyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxVisitsPerDay" INTEGER,
    "notes" TEXT,
    "itinerary" JSONB,
    "status" "TripPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tripPlan_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "agentConversation" ADD COLUMN "tripPlanId" TEXT;

-- CreateIndex
CREATE INDEX "tripPlan_userId_updatedAt_idx" ON "tripPlan"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "agentConversation_userId_tripPlanId_lastMessageAt_idx" ON "agentConversation"("userId", "tripPlanId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "tripPlan" ADD CONSTRAINT "tripPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversation" ADD CONSTRAINT "agentConversation_tripPlanId_fkey" FOREIGN KEY ("tripPlanId") REFERENCES "tripPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
