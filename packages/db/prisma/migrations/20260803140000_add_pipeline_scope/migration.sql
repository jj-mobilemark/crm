-- AlterTable
ALTER TABLE "agentConversation" ADD COLUMN "pipelineScope" TEXT;

-- CreateIndex
CREATE INDEX "agentConversation_userId_pipelineScope_lastMessageAt_idx" ON "agentConversation"("userId", "pipelineScope", "lastMessageAt");
