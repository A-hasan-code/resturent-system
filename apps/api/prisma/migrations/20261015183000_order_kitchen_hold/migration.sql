-- Advance / reserved orders stay off the kitchen board and timers until guest is seated.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "kitchenHold" BOOLEAN NOT NULL DEFAULT false;
