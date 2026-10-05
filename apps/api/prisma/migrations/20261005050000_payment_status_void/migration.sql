-- Cancelled orders must never appear as unpaid. Introduce VOID payment status.
CREATE TYPE "PaymentStatus_new" AS ENUM ('UNPAID', 'PAID', 'PARTIAL', 'VOID');

ALTER TABLE "Order" ALTER COLUMN "paymentStatus" DROP DEFAULT;
ALTER TABLE "Order"
  ALTER COLUMN "paymentStatus" TYPE "PaymentStatus_new"
  USING ("paymentStatus"::text::"PaymentStatus_new");

ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";

ALTER TABLE "Order" ALTER COLUMN "paymentStatus" SET DEFAULT 'UNPAID';

-- Existing cancelled orders kept paymentStatus=UNPAID; flip them to VOID.
UPDATE "Order"
SET "paymentStatus" = 'VOID'
WHERE "status" = 'CANCELLED'
  AND "paymentStatus" <> 'PAID';
