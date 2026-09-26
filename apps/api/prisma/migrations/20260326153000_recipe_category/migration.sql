-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'General';
