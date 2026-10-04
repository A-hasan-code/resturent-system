-- Per-head / cover charge line kind (not a menu item; priced from Settings).
CREATE TYPE "OrderLineKind" AS ENUM ('MENU', 'PER_HEAD');

ALTER TABLE "OrderItem" ADD COLUMN "lineKind" "OrderLineKind" NOT NULL DEFAULT 'MENU';

ALTER TABLE "OrderItem" ALTER COLUMN "menuItemId" DROP NOT NULL;

CREATE INDEX "OrderItem_orderId_lineKind_idx" ON "OrderItem"("orderId", "lineKind");
