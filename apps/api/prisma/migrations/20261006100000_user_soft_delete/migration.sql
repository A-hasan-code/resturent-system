-- Soft-delete users so staff with payment/bill history can be removed safely.
-- Idempotent: restore / partial apply may already have the column.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");
