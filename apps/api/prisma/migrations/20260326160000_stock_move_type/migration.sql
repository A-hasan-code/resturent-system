-- CreateEnum
CREATE TYPE "StockMoveType" AS ENUM ('IN', 'OUT', 'ADJUST', 'SALE');

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "type" "StockMoveType" NOT NULL DEFAULT 'IN';
