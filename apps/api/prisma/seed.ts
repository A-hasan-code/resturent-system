import { KitchenStation, PrismaClient, UnitType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PERMS = [
  ["store.view", "View store"],
  ["store.manage", "Manage store"],
  ["recipe.view", "View recipes"],
  ["recipe.manage", "Manage recipes"],
  ["menu.view", "View menu"],
  ["menu.manage", "Manage menu"],
  ["order.create", "Create orders"],
  ["order.pay", "Take payment"],
  ["order.edit", "Edit order items (main cashier)"],
  ["bill.view", "View bills"],
  ["kitchen.view", "Kitchen view"],
  ["kitchen.update", "Update kitchen status"],
  ["reports.view", "View reports"],
  ["users.manage", "Manage users"],
  ["order.addItems", "Add items to open order"],
  ["order.viewOwn", "View own orders"],
  ["bill.request", "Request bill"],
  ["print.kot", "Print kitchen slip"],
  ["print.bill", "Print customer bill"],
  ["printers.manage", "Manage printers"],
  ["tables.manage", "Manage tables"],
  ["system.manage", "Server settings & backups"],
  ["cash.keep", "Keeps the cash drawer (receives handovers)"],
  ["payments.view", "View payment & cash handover records"],
] as const;

const ROLE_PERMS: Record<string, string[]> = {
  ADMIN: PERMS.map(([c]) => c),
  SUPERVISOR: [
    "order.create",
    "order.addItems",
    "order.viewOwn",
    "bill.request",
    "print.kot",
    "kitchen.view",
    "kitchen.update",
  ],
  MAIN_CASHIER: [
    "menu.view",
    "order.create",
    "order.addItems",
    "order.edit",
    "order.pay",
    "bill.view",
    "bill.request",
    "kitchen.view",
    "reports.view",
    "print.kot",
    "print.bill",
    "cash.keep",
  ],
  CASHIER: [
    "menu.view",
    "order.create",
    "order.addItems",
    "order.pay",
    "bill.view",
    "bill.request",
    "kitchen.view",
    "reports.view",
    "print.kot",
    "print.bill",
    "cash.keep",
  ],
  STORE: ["store.view", "store.manage"],
  KITCHEN: ["kitchen.view", "kitchen.update", "print.kot"],
  WAITER: ["order.viewOwn", "bill.request", "kitchen.view"],
};

const ROLES = [
  { code: "ADMIN", name: "Admin" },
  { code: "SUPERVISOR", name: "Supervisor" },
  { code: "MAIN_CASHIER", name: "Main Cashier" },
  { code: "CASHIER", name: "Cashier" },
  { code: "STORE", name: "Store" },
  { code: "KITCHEN", name: "Kitchen" },
  { code: "WAITER", name: "Waiter" },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  "restaurant.name": "Hotel System",
  "restaurant.tagline": "Fine Dining · BBQ · Karahi",
  "restaurant.address": "Pakistan",
  "restaurant.phone": "0300-0000000",
  "restaurant.accent": "#0f7a6c",
  "billing.perHeadEnabled": "1",
  "billing.perHeadAmount": "100",
  "billing.perHeadLabel": "Per head",
};

async function upsertItem(
  categoryId: string,
  name: string,
  unit: UnitType,
  qty: number,
  rate: number,
  reorder = 5
) {
  return prisma.storeItem.upsert({
    where: { categoryId_name: { categoryId, name } },
    update: { quantityOnHand: qty, ratePerUnit: rate, unit, reorderLevel: reorder },
    create: {
      name,
      categoryId,
      unit,
      quantityOnHand: qty,
      ratePerUnit: rate,
      reorderLevel: reorder,
    },
  });
}

async function main() {
  for (const [code, name] of PERMS) {
    await prisma.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
  }

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: r,
    });
    const codes = ROLE_PERMS[r.code] ?? [];
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
  }

  // Migrate legacy MANAGER → SUPERVISOR
  const manager = await prisma.role.findUnique({ where: { code: "MANAGER" } });
  const supervisor = await prisma.role.findUniqueOrThrow({ where: { code: "SUPERVISOR" } });
  if (manager) {
    await prisma.user.updateMany({ where: { roleId: manager.id }, data: { roleId: supervisor.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: manager.id } });
    await prisma.role.delete({ where: { id: manager.id } }).catch(() => undefined);
  }

  const roleId = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;

  const users = [
    { username: "admin", name: "Admin", pass: "admin123", role: "ADMIN" },
    { username: "supervisor", name: "Supervisor Usman", pass: "super123", pin: "2222", role: "SUPERVISOR" },
    { username: "maincashier", name: "Main Cashier", pass: "main123", pin: "3333", role: "MAIN_CASHIER" },
    { username: "cashier", name: "Cashier Ali", pass: "cashier123", pin: "4444", role: "CASHIER" },
    { username: "cashier2", name: "Cashier Two", pass: "cashier123", pin: "4445", role: "CASHIER" },
    { username: "kitchen", name: "Kitchen Staff", pass: "kitchen123", role: "KITCHEN" },
    { username: "store", name: "Store Keeper", pass: "store123", role: "STORE" },
    { username: "waiter", name: "Waiter Ahmed", pass: "waiter123", pin: "1111", role: "WAITER" },
    { username: "waiter2", name: "Waiter Bilal", pass: "waiter123", pin: "1112", role: "WAITER" },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.pass, 10);
    const pinHash = u.pin ? await bcrypt.hash(u.pin, 10) : null;
    const rid = await roleId(u.role);
    const exists = await prisma.user.findUnique({ where: { username: u.username } });
    if (exists) {
      // Keep demo accounts usable after role/PIN changes (local test).
      await prisma.user.update({
        where: { id: exists.id },
        data: {
          name: u.name,
          roleId: rid,
          active: true,
          passwordHash,
          ...(pinHash ? { pinHash } : {}),
        },
      });
      continue;
    }
    await prisma.user.create({
      data: {
        username: u.username,
        name: u.name,
        passwordHash,
        pinHash,
        roleId: rid,
      },
    });
  }

  // Rename old manager login to supervisor role if still present
  const oldMgr = await prisma.user.findUnique({ where: { username: "manager" } });
  if (oldMgr) {
    await prisma.user.update({
      where: { id: oldMgr.id },
      data: { roleId: await roleId("SUPERVISOR"), name: oldMgr.name.includes("Manager") ? "Supervisor Usman" : oldMgr.name },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // Older DBs may still have global unique(name); partitions need per-partition names (Hall T-1 + Lawn T-1).
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "RestaurantTable_name_key"`);

  // Partitions + demo tables (Hall T-1..15, Lawn T-1..10). Safe after migration that may create empty Hall.
  const hall =
    (await prisma.tablePartition.findUnique({ where: { name: "Hall" } })) ??
    (await prisma.tablePartition.create({ data: { name: "Hall", sortOrder: 1 } }));
  const lawn =
    (await prisma.tablePartition.findUnique({ where: { name: "Lawn" } })) ??
    (await prisma.tablePartition.create({ data: { name: "Lawn", sortOrder: 2 } }));

  async function ensureTables(partitionId: string, area: string, count: number) {
    const existing = await prisma.restaurantTable.count({ where: { partitionId } });
    if (existing >= count) return;
    const have = new Set(
      (await prisma.restaurantTable.findMany({ where: { partitionId }, select: { name: true } })).map((t) => t.name)
    );
    const rows = Array.from({ length: count }, (_, i) => `T-${i + 1}`)
      .filter((name) => !have.has(name))
      .map((name, i) => ({
        name,
        partitionId,
        area,
        sortOrder: i + 1,
        active: true,
      }));
    if (rows.length) await prisma.restaurantTable.createMany({ data: rows });
  }

  await ensureTables(hall.id, "Hall", 15);
  await ensureTables(lawn.id, "Lawn", 10);

  if ((await prisma.printer.count()) === 0) {
    await prisma.printer.createMany({
      data: [
        {
          name: "Kitchen · Beverages",
          kind: "FILE",
          target: "",
          printsKot: true,
          printsBill: false,
          categories: "Beverages",
        },
        {
          name: "Kitchen · Cooking",
          kind: "FILE",
          target: "",
          printsKot: true,
          printsBill: false,
          categories: "Cooking",
        },
        {
          name: "Kitchen · BBQ",
          kind: "FILE",
          target: "",
          printsKot: true,
          printsBill: false,
          categories: "BBQ",
        },
        {
          name: "Cashier bill (preview)",
          kind: "FILE",
          target: "",
          printsKot: false,
          printsBill: true,
          station: "Main",
        },
      ],
    });
  }

  for (const name of ["Karahi", "BBQ", "Sweet", "Drinks", "Rice", "Curry", "General", "Beverages", "Cooking"]) {
    await prisma.recipeCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  // Backfill kitchenStation from category heuristics
  await prisma.menuItem.updateMany({
    where: { OR: [{ category: { contains: "Drink", mode: "insensitive" } }, { category: { contains: "Beverage", mode: "insensitive" } }] },
    data: { kitchenStation: KitchenStation.BEVERAGES },
  });
  await prisma.menuItem.updateMany({
    where: { category: { contains: "BBQ", mode: "insensitive" } },
    data: { kitchenStation: KitchenStation.BBQ },
  });

  if ((await prisma.storeItem.count()) > 0) {
    console.log("Seed OK — roles/partitions/settings updated (existing inventory kept)");
    return;
  }
  await seedDemoData();
  console.log("Seed OK — full demo data");
}

async function seedDemoData() {
  for (const c of [
    { code: "FRESH", name: "Fresh", sortOrder: 1 },
    { code: "DRY", name: "Dry", sortOrder: 2 },
    { code: "LIQUID", name: "Liquid", sortOrder: 3 },
  ]) {
    await prisma.storeCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: c,
    });
  }

  const fresh = await prisma.storeCategory.findUniqueOrThrow({ where: { code: "FRESH" } });
  const dry = await prisma.storeCategory.findUniqueOrThrow({ where: { code: "DRY" } });
  const liquid = await prisma.storeCategory.findUniqueOrThrow({ where: { code: "LIQUID" } });

  const chicken = await upsertItem(fresh.id, "Chicken", UnitType.KG, 40, 650, 8);
  const mutton = await upsertItem(fresh.id, "Mutton", UnitType.KG, 15, 1800, 5);
  const tomato = await upsertItem(fresh.id, "Tomato", UnitType.KG, 20, 80, 4);
  const onion = await upsertItem(fresh.id, "Onion", UnitType.KG, 25, 60, 5);
  const ginger = await upsertItem(fresh.id, "Ginger Garlic", UnitType.KG, 8, 350, 2);
  const yoghurt = await upsertItem(fresh.id, "Yoghurt", UnitType.KG, 10, 200, 3);
  const rice = await upsertItem(dry.id, "Rice", UnitType.KG, 50, 280, 10);
  const chilli = await upsertItem(dry.id, "Red Chilli", UnitType.KG, 5, 900, 1);
  const sugar = await upsertItem(dry.id, "Sugar", UnitType.KG, 20, 160, 3);
  const oil = await upsertItem(liquid.id, "Cooking Oil", UnitType.L, 30, 480, 5);
  const milk = await upsertItem(liquid.id, "Milk", UnitType.L, 20, 220, 4);
  const syrup = await upsertItem(liquid.id, "Rooh Afza", UnitType.L, 6, 900, 1);

  async function ensureRecipe(
    name: string,
    category: string,
    baseUnit: UnitType,
    ingredients: { storeItemId: string; quantity: number; unit: UnitType }[]
  ) {
    const existing = await prisma.recipe.findUnique({ where: { name } });
    if (existing) {
      return prisma.recipe.update({
        where: { id: existing.id },
        data: { category, baseUnit, active: true },
      });
    }
    return prisma.recipe.create({
      data: {
        name,
        category,
        baseUnit,
        baseQty: 1,
        ingredients: { create: ingredients },
      },
    });
  }

  const rKarahi = await ensureRecipe("Chicken Karahi", "Karahi", UnitType.KG, [
    { storeItemId: chicken.id, quantity: 1, unit: UnitType.KG },
    { storeItemId: oil.id, quantity: 0.15, unit: UnitType.L },
    { storeItemId: tomato.id, quantity: 0.3, unit: UnitType.KG },
    { storeItemId: chilli.id, quantity: 0.02, unit: UnitType.KG },
    { storeItemId: ginger.id, quantity: 0.05, unit: UnitType.KG },
  ]);
  const rMutton = await ensureRecipe("Mutton Karahi", "Karahi", UnitType.KG, [
    { storeItemId: mutton.id, quantity: 1, unit: UnitType.KG },
    { storeItemId: oil.id, quantity: 0.18, unit: UnitType.L },
    { storeItemId: tomato.id, quantity: 0.35, unit: UnitType.KG },
    { storeItemId: onion.id, quantity: 0.2, unit: UnitType.KG },
  ]);
  const rBiryani = await ensureRecipe("Chicken Biryani", "Rice", UnitType.KG, [
    { storeItemId: chicken.id, quantity: 0.6, unit: UnitType.KG },
    { storeItemId: rice.id, quantity: 0.5, unit: UnitType.KG },
    { storeItemId: oil.id, quantity: 0.1, unit: UnitType.L },
    { storeItemId: yoghurt.id, quantity: 0.15, unit: UnitType.KG },
  ]);
  const rLassi = await ensureRecipe("Sweet Lassi", "Drinks", UnitType.L, [
    { storeItemId: yoghurt.id, quantity: 0.4, unit: UnitType.KG },
    { storeItemId: milk.id, quantity: 0.4, unit: UnitType.L },
    { storeItemId: sugar.id, quantity: 0.08, unit: UnitType.KG },
  ]);
  const rSharbat = await ensureRecipe("Rooh Afza Sharbat", "Drinks", UnitType.L, [
    { storeItemId: syrup.id, quantity: 0.08, unit: UnitType.L },
    { storeItemId: milk.id, quantity: 0.2, unit: UnitType.L },
  ]);

  const menus = [
    { id: "seed-chicken-karahi", name: "Chicken Karahi", category: "Cooking", station: KitchenStation.COOKING, unit: UnitType.KG, price: 1800, recipeId: rKarahi.id },
    { id: "seed-mutton-karahi", name: "Mutton Karahi", category: "Cooking", station: KitchenStation.COOKING, unit: UnitType.KG, price: 3200, recipeId: rMutton.id },
    { id: "seed-biryani", name: "Chicken Biryani", category: "Cooking", station: KitchenStation.COOKING, unit: UnitType.KG, price: 1400, recipeId: rBiryani.id },
    { id: "seed-lassi", name: "Sweet Lassi", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.L, price: 250, recipeId: rLassi.id },
    { id: "seed-sharbat", name: "Rooh Afza", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.L, price: 180, recipeId: rSharbat.id },
    { id: "seed-chai", name: "Chai", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 80, recipeId: null },
    { id: "seed-chapli", name: "Chapli Kabab", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 120, recipeId: null },
    { id: "seed-tika", name: "Chicken Tikka", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 450, recipeId: null },
  ];

  for (const m of menus) {
    await prisma.menuItem.upsert({
      where: { id: m.id },
      update: {
        name: m.name,
        category: m.category,
        kitchenStation: m.station,
        sellUnit: m.unit,
        sellingPrice: m.price,
        recipeId: m.recipeId,
        active: true,
      },
      create: {
        id: m.id,
        name: m.name,
        category: m.category,
        kitchenStation: m.station,
        sellUnit: m.unit,
        sellingPrice: m.price,
        recipeId: m.recipeId,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
