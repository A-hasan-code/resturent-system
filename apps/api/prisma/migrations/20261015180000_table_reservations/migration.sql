-- Soft table holds + guest fields on advance (pre) orders.
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedGuestName" TEXT;
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedPhone" TEXT;
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedPartySize" INTEGER;
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedFor" TIMESTAMP(3);
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedNotes" TEXT;
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedById" TEXT;
ALTER TABLE "RestaurantTable" ADD COLUMN IF NOT EXISTS "reservedAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "guestName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "guestPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "partySize" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reservedFor" TIMESTAMP(3);
