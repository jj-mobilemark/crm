-- Lock Deal.probability to the Mobile Mark stage band and recompute
-- weightedAmount = amount × probability / 100. Certainty is no longer
-- independently editable from Sage or the deal sheet.

UPDATE "deal"
SET "probability" = CASE "stage"
  WHEN 'DEMO_BOOKED' THEN 10
  WHEN 'QUALIFIED_TO_BUY' THEN 25
  WHEN 'DECISION_MAKER_BOUGHT_IN' THEN 50
  WHEN 'CONTRACT_SENT' THEN 75
  WHEN 'IN_PURCHASING' THEN 90
  WHEN 'CLOSED_WON' THEN 100
  WHEN 'CLOSED_LOST' THEN 0
  WHEN 'UNQUALIFIED_TO_BUY' THEN 0
  ELSE "probability"
END;

UPDATE "deal"
SET "weightedAmount" = ROUND(("amount" * "probability") / 100.0, 2)
WHERE "amount" IS NOT NULL
  AND "probability" IS NOT NULL;

UPDATE "deal"
SET "weightedAmount" = NULL
WHERE "amount" IS NULL OR "probability" IS NULL;
