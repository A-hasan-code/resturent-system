-- Actual ingredient cost accumulated when logging special cook.
ALTER TABLE "DailyBatch" ADD COLUMN "cookCostTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
