-- Other print: office/A4 PDFs on server Windows printers
ALTER TYPE "PrintJobType" ADD VALUE IF NOT EXISTS 'REPORT';

ALTER TABLE "Printer" ADD COLUMN IF NOT EXISTS "printsOther" BOOLEAN NOT NULL DEFAULT false;
