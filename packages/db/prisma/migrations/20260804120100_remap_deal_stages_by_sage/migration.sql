-- Remap by raw Sage stage after IN_PURCHASING exists (separate migration so
-- Postgres can use the new enum value). Do not touch probability.
-- Order: Purchasing off CONTRACT_SENT first, then swap Negotiation / Proposal.
-- Table is @@map("deal") — lowercase quoted identifier.

UPDATE "deal"
SET "stage" = 'IN_PURCHASING'
WHERE lower(trim("sageStage")) = 'purchasing';

UPDATE "deal"
SET "stage" = 'CONTRACT_SENT'
WHERE lower(trim("sageStage")) = 'negotiation';

UPDATE "deal"
SET "stage" = 'DECISION_MAKER_BOUGHT_IN'
WHERE lower(trim("sageStage")) = 'proposal';

UPDATE "deal"
SET "stage" = 'QUALIFIED_TO_BUY'
WHERE lower(trim("sageStage")) = 'investigation/prospecting'
  AND "stage" <> 'QUALIFIED_TO_BUY';
