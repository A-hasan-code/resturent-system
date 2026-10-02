-- Industrial multi-counter: station label on printers + per-cashier default bill printer
ALTER TABLE "Printer" ADD COLUMN IF NOT EXISTS "station" TEXT NOT NULL DEFAULT '';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billPrinterId" TEXT;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_billPrinterId_fkey"
    FOREIGN KEY ("billPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
