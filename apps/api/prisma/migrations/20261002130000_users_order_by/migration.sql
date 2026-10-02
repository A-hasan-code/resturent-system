-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "addedById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pinHash" TEXT;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the order taker is now always stored in waiterId (cashiers used to be stored in cashierId only).
UPDATE "Order" SET "waiterId" = "cashierId" WHERE "waiterId" IS NULL AND "cashierId" IS NOT NULL;
UPDATE "OrderItem" i SET "addedById" = o."waiterId" FROM "Order" o WHERE i."orderId" = o."id" AND i."addedById" IS NULL;
