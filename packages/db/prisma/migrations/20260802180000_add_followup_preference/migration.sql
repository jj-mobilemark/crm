-- CreateTable
CREATE TABLE "followUpPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "floatFirst" TEXT NOT NULL DEFAULT 'balanced',
    "lookback" TEXT NOT NULL DEFAULT '30d',
    "scope" TEXT NOT NULL DEFAULT 'owned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followUpPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "followUpPreference_userId_key" ON "followUpPreference"("userId");

-- AddForeignKey
ALTER TABLE "followUpPreference" ADD CONSTRAINT "followUpPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
