-- AlterTable
ALTER TABLE "company" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "geocodePlaceKey" TEXT,
ADD COLUMN "geocodedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "company_geocodePlaceKey_idx" ON "company"("geocodePlaceKey");

-- CreateEnum
CREATE TYPE "GeocodeCacheStatus" AS ENUM ('ok', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "geocodeCache" (
    "placeKey" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "GeocodeCacheStatus" NOT NULL,
    "rawLabel" TEXT,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocodeCache_pkey" PRIMARY KEY ("placeKey")
);
