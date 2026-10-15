/**
 * Upsert counter grocery: store + recipes + menu (Biscuit, Nimko, Cigarette Full/Half).
 * Does not reset qty on existing store rows — only fills pack/rate/reorder and creates if missing.
 */
import { KitchenStation, PackUnit, PrismaClient, UnitType } from "@prisma/client";

const prisma = new PrismaClient();

const STORE = [
  {
    key: "biscuit",
    name: "Biscuit",
    unit: UnitType.PCS,
    packUnit: PackUnit.BOX,
    unitsPerPack: 240,
    openingQty: 240,
    rate: 5,
    reorder: 48,
  },
  {
    key: "nimko",
    name: "Nimko",
    unit: UnitType.PCS,
    packUnit: PackUnit.BOX,
    unitsPerPack: 24,
    openingQty: 48,
    rate: 40,
    reorder: 12,
  },
  {
    key: "cigarette",
    name: "Cigarette Pack",
    unit: UnitType.PCS,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 10,
    openingQty: 20,
    rate: 450,
    reorder: 5,
  },
] as const;

const RECIPES = [
  {
    key: "biscuit_1pc",
    name: "Biscuit (1 piece)",
    storeKey: "biscuit" as const,
    qty: 1,
  },
  {
    key: "nimko_1pk",
    name: "Nimko (1 packet)",
    storeKey: "nimko" as const,
    qty: 1,
  },
  {
    key: "cigarette_full",
    name: "Cigarette (Full pack)",
    storeKey: "cigarette" as const,
    qty: 1,
  },
  {
    key: "cigarette_half",
    name: "Cigarette (Half pack)",
    storeKey: "cigarette" as const,
    qty: 0.5,
  },
] as const;

const MENU = [
  { name: "Biscuit", price: 20, recipeKey: "biscuit_1pc" as const },
  { name: "Nimko", price: 50, recipeKey: "nimko_1pk" as const },
  { name: "Cigarette (Full)", price: 500, recipeKey: "cigarette_full" as const },
  { name: "Cigarette (Half)", price: 260, recipeKey: "cigarette_half" as const },
];

async function main() {
  await prisma.recipeCategory.upsert({
    where: { name: "Grocery" },
    update: {},
    create: { name: "Grocery" },
  });

  const cat = await prisma.storeCategory.upsert({
    where: { code: "GROCERY" },
    update: { name: "Grocery", sortOrder: 4 },
    create: { code: "GROCERY", name: "Grocery", sortOrder: 4 },
  });

  const storeIds: Record<string, string> = {};
  for (const s of STORE) {
    const existing = await prisma.storeItem.findUnique({
      where: { categoryId_name: { categoryId: cat.id, name: s.name } },
    });
    if (existing) {
      const row = await prisma.storeItem.update({
        where: { id: existing.id },
        data: {
          unit: s.unit,
          packUnit: s.packUnit,
          unitsPerPack: s.unitsPerPack,
          ratePerUnit: s.rate,
          reorderLevel: s.reorder,
          active: true,
        },
      });
      storeIds[s.key] = row.id;
      console.log("store update", s.name, row.id);
    } else {
      const row = await prisma.storeItem.create({
        data: {
          name: s.name,
          categoryId: cat.id,
          unit: s.unit,
          packUnit: s.packUnit,
          unitsPerPack: s.unitsPerPack,
          quantityOnHand: s.openingQty,
          ratePerUnit: s.rate,
          reorderLevel: s.reorder,
        },
      });
      if (s.openingQty > 0) {
        await prisma.stockMovement.create({
          data: {
            storeItemId: row.id,
            type: "IN",
            quantity: s.openingQty,
            ratePerUnit: s.rate,
            note: "Opening · grocery counter",
          },
        });
      }
      storeIds[s.key] = row.id;
      console.log("store create", s.name, row.id);
    }
  }

  const recipeIds: Record<string, string> = {};
  for (const r of RECIPES) {
    const storeItemId = storeIds[r.storeKey];
    const existing = await prisma.recipe.findUnique({ where: { name: r.name } });
    if (existing) {
      await prisma.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
      const row = await prisma.recipe.update({
        where: { id: existing.id },
        data: {
          category: "Grocery",
          baseUnit: UnitType.PCS,
          baseQty: 1,
          active: true,
          ingredients: {
            create: [{ storeItemId, quantity: r.qty, unit: UnitType.PCS }],
          },
        },
      });
      recipeIds[r.key] = row.id;
      console.log("recipe update", r.name);
    } else {
      const row = await prisma.recipe.create({
        data: {
          name: r.name,
          category: "Grocery",
          baseUnit: UnitType.PCS,
          baseQty: 1,
          ingredients: {
            create: [{ storeItemId, quantity: r.qty, unit: UnitType.PCS }],
          },
        },
      });
      recipeIds[r.key] = row.id;
      console.log("recipe create", r.name);
    }
  }

  for (const m of MENU) {
    const recipeId = recipeIds[m.recipeKey];
    const existing = await prisma.menuItem.findFirst({
      where: { name: m.name, category: "Grocery" },
    });
    const data = {
      kitchenStation: KitchenStation.BEVERAGES,
      sellUnit: UnitType.PCS,
      sellingPrice: m.price,
      listPortionQty: 1,
      minQty: 1,
      maxQty: null as number | null,
      qtyStep: 1,
      allowCustomQty: false,
      recipeId,
      active: true,
    };
    if (existing) {
      await prisma.menuItem.update({ where: { id: existing.id }, data });
      console.log("menu update", m.name);
    } else {
      await prisma.menuItem.create({
        data: { name: m.name, category: "Grocery", ...data },
      });
      console.log("menu create", m.name);
    }
  }

  console.log("Grocery counter ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
