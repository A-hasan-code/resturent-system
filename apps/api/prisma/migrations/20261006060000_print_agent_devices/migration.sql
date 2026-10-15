-- USB / PnP device snapshot from Additional PC agents (Unknown USB diagnosis)
ALTER TABLE "PrintAgent" ADD COLUMN IF NOT EXISTS "devices" JSONB NOT NULL DEFAULT '[]';
