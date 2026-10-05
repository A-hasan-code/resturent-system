-- Additional PC USB printers via desktop print agent
ALTER TYPE "PrinterKind" ADD VALUE IF NOT EXISTS 'AGENT';

CREATE TABLE IF NOT EXISTS "PrintAgent" (
    "id" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrintAgent_machineKey_key" ON "PrintAgent"("machineKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PrintAgent_token_key" ON "PrintAgent"("token");

ALTER TABLE "Printer" ADD COLUMN IF NOT EXISTS "agentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Printer" ADD CONSTRAINT "Printer_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "PrintAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Printer_agentId_target_key" ON "Printer"("agentId", "target");
