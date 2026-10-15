-- Track grams moved forward as carry so remaining does not double-count.
ALTER TABLE "DailyBatch" ADD COLUMN "carryOutGrams" DECIMAL(14,3) NOT NULL DEFAULT 0;
