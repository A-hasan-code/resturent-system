-- Menu order qty rules (min / max / step / custom typing)
ALTER TABLE "MenuItem" ADD COLUMN "minQty" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "MenuItem" ADD COLUMN "maxQty" DECIMAL(14,3);
ALTER TABLE "MenuItem" ADD COLUMN "qtyStep" DECIMAL(14,3);
ALTER TABLE "MenuItem" ADD COLUMN "allowCustomQty" BOOLEAN NOT NULL DEFAULT true;
