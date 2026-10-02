-- Tip tracking + optional table server (separate from order-taker)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tipAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "servedById" TEXT;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "tipAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "TipShare" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TipShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TipShare_userId_createdAt_idx" ON "TipShare"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TipShare_createdAt_idx" ON "TipShare"("createdAt");
CREATE INDEX IF NOT EXISTS "TipShare_orderId_idx" ON "TipShare"("orderId");

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_servedById_fkey"
    FOREIGN KEY ("servedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
