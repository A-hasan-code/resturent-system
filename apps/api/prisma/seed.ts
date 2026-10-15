import { PackUnit, PrismaClient, UnitType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { FULL_MENU_RECIPES } from "./full-menu-recipes";

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
  ["expense.view", "View hotel expense sheet"],
  ["expense.manage", "Add and edit hotel expenses"],
  ["close.view", "View daily cash close report"],
  ["close.manage", "Save daily cash close report"],
] as const;

const ROLE_PERMS: Record<string, string[]> = {
  ADMIN: PERMS.map(([c]) => c),
  SYSTEM_MANAGER: [
    "close.view",
    "close.manage",
    "payments.view",
    "reports.view",
    "bill.view",
    "order.edit",
    "kitchen.view",
    "expense.view",
    "expense.manage",
    "menu.view",
    "menu.manage",
    "store.view",
    "store.manage",
  ],
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
  WAITER: [
    "order.create",
    "order.addItems",
    "order.viewOwn",
    "bill.request",
    "print.kot",
    "kitchen.view",
  ],
};

const ROLES = [
  { code: "ADMIN", name: "Admin" },
  { code: "SYSTEM_MANAGER", name: "System Manager" },
  { code: "SUPERVISOR", name: "Supervisor" },
  { code: "MAIN_CASHIER", name: "Main Cashier" },
  { code: "CASHIER", name: "Cashier" },
  { code: "STORE", name: "Store" },
  { code: "KITCHEN", name: "Kitchen" },
  { code: "WAITER", name: "Waiter" },
];

const SETTINGS: Record<string, string> = {
  "restaurant.name": "کوئٹہ سنگت چائے خانہ ہوٹل اینڈ ریسٹورنٹ",
  "restaurant.tagline": "Quetta Sangat Chaye Khana Hotel & Restaurant",
  "restaurant.address": "Adda Lunda Minor, Kehror Pakka Road, Dunyapur",
  "restaurant.phone": "0300 0607 222",
  "restaurant.accent": "#0f7a6c",
  "billing.perHeadEnabled": "1",
  "billing.perHeadAmount": "100",
  "billing.perHeadLabel": "Per head",
  "billing.perHeadPackage": "[]",
};

type StoreDef = {
  key: string;
  name: string;
  cat: "FRESH" | "DRY" | "LIQUID" | "GROCERY";
  unit: UnitType;
  qty: number;
  rate: number;
  reorder?: number;
  packUnit?: PackUnit;
  unitsPerPack?: number;
};

/** Inventory items used by standard recipes (starting stock approx). */
const STORE_ITEMS: StoreDef[] = [
  { key: "chicken", name: "Chicken (bone-in)", cat: "FRESH", unit: UnitType.KG, qty: 40, rate: 650, reorder: 8 },
  { key: "chicken_boneless", name: "Chicken Boneless", cat: "FRESH", unit: UnitType.KG, qty: 15, rate: 780, reorder: 4 },
  { key: "chicken_mince", name: "Chicken Mince", cat: "FRESH", unit: UnitType.KG, qty: 10, rate: 700, reorder: 3 },
  { key: "chicken_breast", name: "Chicken Breast", cat: "FRESH", unit: UnitType.KG, qty: 8, rate: 820, reorder: 2 },
  { key: "beef", name: "Beef (with bone)", cat: "FRESH", unit: UnitType.KG, qty: 25, rate: 1400, reorder: 5 },
  { key: "beef_mince", name: "Beef Mince", cat: "FRESH", unit: UnitType.KG, qty: 10, rate: 1500, reorder: 3 },
  { key: "mutton", name: "Mutton", cat: "FRESH", unit: UnitType.KG, qty: 20, rate: 1800, reorder: 5 },
  { key: "paneer", name: "Paneer", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 900, reorder: 1 },
  { key: "fish", name: "Fish (grill)", cat: "FRESH", unit: UnitType.KG, qty: 8, rate: 1200, reorder: 2 },
  { key: "cucumber", name: "Cucumber", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 80, reorder: 1 },
  { key: "lettuce", name: "Lettuce / Salad leaves", cat: "FRESH", unit: UnitType.KG, qty: 3, rate: 120, reorder: 0.5 },
  { key: "tomato", name: "Tomato", cat: "FRESH", unit: UnitType.KG, qty: 25, rate: 80, reorder: 5 },
  { key: "onion", name: "Onion", cat: "FRESH", unit: UnitType.KG, qty: 30, rate: 60, reorder: 5 },
  { key: "garlic", name: "Garlic", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 400, reorder: 1 },
  { key: "ginger", name: "Ginger", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 350, reorder: 1 },
  { key: "green_chilli", name: "Green Chilli", cat: "FRESH", unit: UnitType.KG, qty: 4, rate: 200, reorder: 1 },
  { key: "capsicum", name: "Capsicum", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 180, reorder: 1 },
  { key: "carrot", name: "Carrot", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 100, reorder: 1 },
  { key: "cabbage", name: "Cabbage", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 80, reorder: 1 },
  { key: "spring_onion", name: "Spring Onion", cat: "FRESH", unit: UnitType.KG, qty: 2, rate: 150, reorder: 0.5 },
  { key: "coriander", name: "Fresh Coriander", cat: "FRESH", unit: UnitType.KG, qty: 2, rate: 120, reorder: 0.5 },
  { key: "mint", name: "Fresh Mint", cat: "FRESH", unit: UnitType.KG, qty: 1, rate: 150, reorder: 0.3 },
  { key: "lemon", name: "Lemon", cat: "FRESH", unit: UnitType.PCS, qty: 50, rate: 15, reorder: 10 },
  {
    key: "egg",
    name: "Egg",
    cat: "FRESH",
    unit: UnitType.PCS,
    qty: 120,
    rate: 30,
    reorder: 24,
    packUnit: PackUnit.TRAY,
    unitsPerPack: 30,
  },
  { key: "potato", name: "Potato", cat: "FRESH", unit: UnitType.KG, qty: 20, rate: 70, reorder: 5 },

  { key: "rice", name: "Rice (Sella/Basmati)", cat: "DRY", unit: UnitType.KG, qty: 50, rate: 280, reorder: 10 },
  { key: "flour", name: "Flour (Atta/Maida)", cat: "DRY", unit: UnitType.KG, qty: 40, rate: 140, reorder: 8 },
  { key: "salt", name: "Salt", cat: "DRY", unit: UnitType.KG, qty: 10, rate: 40, reorder: 2 },
  { key: "black_pepper", name: "Black Pepper", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 1800, reorder: 0.3 },
  { key: "white_pepper", name: "White Pepper", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 2000, reorder: 0.2 },
  { key: "chilli_flakes", name: "Red Chilli Flakes", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 900, reorder: 0.5 },
  { key: "cumin", name: "Cumin Powder", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 800, reorder: 0.3 },
  { key: "coriander_powder", name: "Coriander Powder", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 600, reorder: 0.3 },
  { key: "coriander_seeds", name: "Coriander Seeds", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 500, reorder: 0.3 },
  { key: "fennel", name: "Fennel Seeds", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 700, reorder: 0.2 },
  { key: "garam_masala", name: "Garam Masala", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 1200, reorder: 0.2 },
  { key: "whole_garam", name: "Whole Garam Masala", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 1400, reorder: 0.2 },
  { key: "cardamom", name: "Green Cardamom", cat: "DRY", unit: UnitType.KG, qty: 0.5, rate: 4500, reorder: 0.1 },
  { key: "cinnamon", name: "Cinnamon", cat: "DRY", unit: UnitType.KG, qty: 0.5, rate: 1800, reorder: 0.1 },
  { key: "chaat_masala", name: "Chaat Masala", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 700, reorder: 0.2 },
  { key: "besan", name: "Roasted Gram Flour", cat: "DRY", unit: UnitType.KG, qty: 5, rate: 250, reorder: 1 },
  { key: "cornstarch", name: "Cornstarch", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 300, reorder: 0.5 },
  { key: "kasoori_methi", name: "Kasoori Methi", cat: "DRY", unit: UnitType.KG, qty: 0.5, rate: 900, reorder: 0.1 },
  { key: "tea", name: "Black Tea Leaves", cat: "DRY", unit: UnitType.KG, qty: 5, rate: 1200, reorder: 1 },
  { key: "green_tea", name: "Green Tea Leaves", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 1500, reorder: 0.2 },
  { key: "sugar", name: "Sugar", cat: "DRY", unit: UnitType.KG, qty: 20, rate: 160, reorder: 3 },
  { key: "gur", name: "Jaggery (Gur)", cat: "DRY", unit: UnitType.KG, qty: 8, rate: 200, reorder: 2 },
  { key: "garlic_paste", name: "Garlic Paste", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 350, reorder: 0.5 },
  { key: "ginger_garlic", name: "Ginger Garlic Paste", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 380, reorder: 0.5 },
  { key: "green_chilli_paste", name: "Green Chilli Paste", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 250, reorder: 0.2 },

  { key: "oil", name: "Cooking Oil", cat: "LIQUID", unit: UnitType.L, qty: 40, rate: 480, reorder: 8 },
  { key: "ghee", name: "Desi Ghee / Tallow", cat: "LIQUID", unit: UnitType.KG, qty: 10, rate: 1200, reorder: 2 },
  { key: "butter", name: "Butter", cat: "LIQUID", unit: UnitType.KG, qty: 5, rate: 1400, reorder: 1 },
  { key: "milk", name: "Full Cream Milk", cat: "LIQUID", unit: UnitType.L, qty: 30, rate: 220, reorder: 5 },
  { key: "cream", name: "Fresh Cream", cat: "LIQUID", unit: UnitType.L, qty: 5, rate: 600, reorder: 1 },
  { key: "yogurt", name: "Yogurt", cat: "LIQUID", unit: UnitType.KG, qty: 10, rate: 200, reorder: 2 },
  { key: "ketchup", name: "Tomato Ketchup", cat: "LIQUID", unit: UnitType.L, qty: 4, rate: 450, reorder: 1 },
  { key: "chilli_garlic_sauce", name: "Chilli Garlic Sauce", cat: "LIQUID", unit: UnitType.L, qty: 3, rate: 500, reorder: 0.5 },
  { key: "soy", name: "Soy Sauce", cat: "LIQUID", unit: UnitType.L, qty: 3, rate: 400, reorder: 0.5 },
  { key: "vinegar", name: "Vinegar", cat: "LIQUID", unit: UnitType.L, qty: 3, rate: 250, reorder: 0.5 },
  { key: "honey", name: "Honey", cat: "LIQUID", unit: UnitType.KG, qty: 2, rate: 900, reorder: 0.3 },

  /** Counter grocery — stock in sell unit; pack = how bought. */
  {
    key: "biscuit",
    name: "Biscuit",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 240,
    rate: 5,
    reorder: 48,
    packUnit: PackUnit.BOX,
    unitsPerPack: 240,
  },
  {
    key: "nimko",
    name: "Nimko",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 48,
    rate: 40,
    reorder: 12,
    packUnit: PackUnit.BOX,
    unitsPerPack: 24,
  },
  {
    key: "cigarette",
    name: "Cigarette Pack",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 20,
    rate: 450,
    reorder: 5,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 10,
  },
  {
    key: "cold_drink_regular",
    name: "Regular Cold Drink",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 48,
    rate: 55,
    reorder: 12,
    packUnit: PackUnit.CRATE,
    unitsPerPack: 24,
  },
  {
    key: "cold_drink_can",
    name: "Cold Drink Can",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 48,
    rate: 90,
    reorder: 12,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 24,
  },
  {
    key: "cold_drink_can_sf",
    name: "Cold Drink Can (Sugar Free)",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 24,
    rate: 100,
    reorder: 6,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 24,
  },
  {
    key: "cold_drink_1l",
    name: "Cold Drink 1 Litre",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 24,
    rate: 140,
    reorder: 6,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 12,
  },
  {
    key: "cold_drink_1_5l",
    name: "Cold Drink 1.5 Litre",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 18,
    rate: 170,
    reorder: 4,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 6,
  },
  {
    key: "cold_drink_2l",
    name: "Cold Drink 2 Litre",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 12,
    rate: 220,
    reorder: 3,
    packUnit: PackUnit.CARTON,
    unitsPerPack: 6,
  },
  {
    key: "mineral_water_small",
    name: "Mineral Water Small",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 48,
    rate: 30,
    reorder: 12,
    packUnit: PackUnit.CRATE,
    unitsPerPack: 24,
  },
  {
    key: "mineral_water_large",
    name: "Mineral Water Large",
    cat: "GROCERY",
    unit: UnitType.PCS,
    qty: 24,
    rate: 70,
    reorder: 6,
    packUnit: PackUnit.CRATE,
    unitsPerPack: 12,
  },
];

type MenuSeed = {
  name: string;
  category: string;
  station: string;
  unit: UnitType;
  price: number;
  recipeKey?: string;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
};

const PCS_FIXED: Pick<MenuSeed, "minQty" | "qtyStep" | "allowCustomQty" | "maxQty"> = {
  minQty: 1,
  qtyStep: 1,
  allowCustomQty: false,
  maxQty: null,
};

/**
 * Half band (KG). Card half price is for ~500g — pass (half×2) as pricePerKg
 * so 0.5 kg bills the printed half rate. Orders: 250g–750g in 250g steps.
 */
function halfKg(
  name: string,
  category: string,
  station: string,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name: `${name} (Half)`,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 0.25,
    maxQty: 0.75,
    qtyStep: 0.25,
    allowCustomQty: true,
  };
}

/** Full band (KG): from 1 kg upward in 0.5 kg steps. Price = per KG. */
function fullKg(
  name: string,
  category: string,
  station: string,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name: `${name} (Full)`,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 1,
    maxQty: null,
    qtyStep: 0.5,
    allowCustomQty: true,
  };
}

/** Handi Full pot fixed at exactly 1 KG (not PCS). */
function fullHandiKg(
  name: string,
  category: string,
  station: string,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name: `${name} (Full)`,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 1,
    maxQty: 1,
    qtyStep: 1,
    allowCustomQty: false,
  };
}

/** Bowl / plate portions (not weight) — keep as separate PCS lines. */
function halfFull(
  base: string,
  category: string,
  station: string,
  half: number,
  full: number,
  recipeKey?: string
): MenuSeed[] {
  return [
    {
      name: `${base} (Half)`,
      category,
      station,
      unit: UnitType.PCS,
      price: half,
      recipeKey,
      ...PCS_FIXED,
    },
    {
      name: `${base} (Full)`,
      category,
      station,
      unit: UnitType.PCS,
      price: full,
      recipeKey,
      ...PCS_FIXED,
    },
  ];
}

/** Meat sold by weight (single line). Price = per KG. Custom from 0.5 kg unless overridden. */
function byKg(
  name: string,
  category: string,
  station: string,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 0.5,
    maxQty: null,
    qtyStep: 0.5,
    allowCustomQty: true,
  };
}

const MENU: MenuSeed[] = [
  // Live Kitchen — fixed PCS (no half/full / no custom grams)
  {
    name: "Mutton Khada Sijji (5hr advance)",
    category: "Live Kitchen",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 4500,
    recipeKey: "mutton_khada_sijji",
    ...PCS_FIXED,
  },
  {
    name: "Ranjha Goshat",
    category: "Live Kitchen",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 4500,
    recipeKey: "ranjha_goshat",
    ...PCS_FIXED,
  },
  {
    name: "Chicken Khada Sijji",
    category: "Live Kitchen",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 2000,
    recipeKey: "chicken_khada_sijji",
    ...PCS_FIXED,
  },
  // Shinwari: card half/full ≈ 950/1800 & 2200/4100 → per-kg rates on Half/Full lines
  halfKg("Chicken Shinwari Karahi", "Live Kitchen", "COOKING", 1900, "chicken_shinwari_karahi"),
  fullKg("Chicken Shinwari Karahi", "Live Kitchen", "COOKING", 1800, "chicken_shinwari_karahi"),
  halfKg("Mutton Shinwari Karahi", "Live Kitchen", "COOKING", 4400, "mutton_shinwari_karahi"),
  fullKg("Mutton Shinwari Karahi", "Live Kitchen", "COOKING", 4100, "mutton_shinwari_karahi"),
  // Banu Pulao → Special Pakistani (KG) — see below
  {
    name: "Dam Pukhat",
    category: "Live Kitchen",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 1000,
    recipeKey: "dam_pukhat",
    ...PCS_FIXED,
  },
  {
    name: "Rosh + Daal",
    category: "Live Kitchen",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 1500,
    recipeKey: "mutton_namkeen_rosh",
    ...PCS_FIXED,
  },
  {
    name: "Paneer BBQ",
    category: "Live Kitchen",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 400,
    recipeKey: "paneer_bbq",
    ...PCS_FIXED,
  },
  {
    name: "Beef BBQ",
    category: "Live Kitchen",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 350,
    recipeKey: "beef_bbq_live",
    ...PCS_FIXED,
  },
  {
    name: "Afghani Boti",
    category: "Live Kitchen",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 200,
    recipeKey: "afghani_boti_live",
    ...PCS_FIXED,
  },

  // Breakfast
  {
    name: "Plain Paratha",
    category: "Breakfast & Paratha",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 60,
    recipeKey: "plain_paratha",
  },
  {
    name: "Aloo Paratha",
    category: "Breakfast & Paratha",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 100,
    recipeKey: "aloo_paratha",
  },
  {
    name: "Special Chicken Paratha",
    category: "Breakfast & Paratha",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 200,
    recipeKey: "special_chicken_paratha",
  },
  {
    name: "Egg Paratha",
    category: "Breakfast & Paratha",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 150,
    recipeKey: "egg_paratha",
  },
  {
    name: "Omelette",
    category: "Breakfast & Paratha",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 100,
    recipeKey: "omelette",
  },
  ...halfFull("Yogurt", "Breakfast & Paratha", "COOKING", 100, 200, "yogurt_bowl"),

  // Appetizers (bowl portions)
  ...halfFull(
    "Quetta Sangat Special Soup",
    "Appetizers",
    "COOKING",
    450,
    700,
    "sangat_special_soup"
  ),
  ...halfFull(
    "Chicken Hot & Sour Soup",
    "Appetizers",
    "COOKING",
    400,
    650,
    "chicken_hot_sour_soup"
  ),
  ...halfFull("Chicken Corn Soup", "Appetizers", "COOKING", 400, 600, "chicken_corn_soup"),
  ...halfFull(
    "Chicken Vegetable Soup",
    "Appetizers",
    "COOKING",
    400,
    600,
    "chicken_veg_soup"
  ),
  {
    name: "Quetta Sangat Special Fries",
    category: "Appetizers",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 300,
    recipeKey: "special_fries",
  },

  // BBQ
  {
    name: "Chicken Tikka Boti",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 200,
    recipeKey: "chicken_tikka_boti",
  },
  {
    name: "Chicken Malai Boti",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 300,
    recipeKey: "chicken_malai_boti",
  },
  {
    name: "Chicken Kasturi Boti",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 350,
    recipeKey: "chicken_kasturi_boti",
  },
  {
    name: "Chicken Afghani Boti",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 200,
    recipeKey: "chicken_afghani_boti",
  },
  {
    name: "Chicken Makhmali Kabab",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 250,
    recipeKey: "chicken_makhmali_kabab",
  },
  {
    name: "Chicken Kalmi Tikka",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 450,
    recipeKey: "chicken_kalmi_tikka",
  },
  {
    name: "Chicken Seekh Kabab",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 180,
    recipeKey: "chicken_seekh_kabab",
  },
  {
    name: "Chicken Reshmi Kabab",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 220,
    recipeKey: "chicken_reshmi_kabab",
  },
  {
    name: "Beef Kabab",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 230,
    recipeKey: "beef_kabab",
  },
  {
    name: "Chicken Turkish Kabab",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 300,
    recipeKey: "chicken_turkish_kabab",
  },
  {
    name: "Chicken Tikka Chest Piece",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 400,
    recipeKey: "chicken_tikka_chest",
  },
  {
    name: "Chicken Tikka Leg Piece",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 350,
    recipeKey: "chicken_tikka_leg",
  },
  {
    name: "Afghani Tikka Chest Piece",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 450,
    recipeKey: "afghani_tikka_chest",
  },
  {
    name: "Afghani Tikka Leg Piece",
    category: "BBQ",
    station: "BBQ",
    unit: UnitType.PCS,
    price: 400,
    recipeKey: "afghani_tikka_leg",
  },
  // PDF Special Grill Fish Rs 600–1200 by weight — mid list rate
  byKg("Special Grill Fish (By Weight)", "BBQ", "BBQ", 900, "grill_fish"),

  // Pakistani Special — Quetta Sangat Special meat (PDF half|full = 500g|1kg)
  halfKg(
    "Mutton Namkeen Gosht Special",
    "Pakistani Special",
    "COOKING",
    4000,
    "mutton_namkeen_gosht"
  ),
  fullKg(
    "Mutton Namkeen Gosht Special",
    "Pakistani Special",
    "COOKING",
    4000,
    "mutton_namkeen_gosht"
  ),
  halfKg("Beef Namkeen Gosht", "Pakistani Special", "COOKING", 2600, "beef_namkeen_gosht"),
  fullKg("Beef Namkeen Gosht", "Pakistani Special", "COOKING", 2400, "beef_namkeen_gosht"),
  {
    name: "Mutton Rosh (Special Daal)",
    category: "Pakistani Special",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 1500,
    recipeKey: "mutton_namkeen_rosh",
    ...PCS_FIXED,
  },
  {
    name: "Beef Namkeen Platter",
    category: "Pakistani Special",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 1000,
    recipeKey: "beef_namkeen_platter",
    ...PCS_FIXED,
  },
  // Daal & sabzi → SPECIAL_PRODUCTS pots (Half/Full rates on pot)

  // Chicken Karahi — PDF 900|1700 … 1650|3200 (half×2 / full)
  halfKg(
    "Quetta Sangat Special Chicken Karahi",
    "Chicken Karahi",
    "COOKING",
    1800,
    "sangat_chicken_karahi"
  ),
  fullKg(
    "Quetta Sangat Special Chicken Karahi",
    "Chicken Karahi",
    "COOKING",
    1700,
    "sangat_chicken_karahi"
  ),
  halfKg("Special Desi Murgha Karahi", "Chicken Karahi", "COOKING", 3300, "desi_murgha_karahi"),
  fullKg("Special Desi Murgha Karahi", "Chicken Karahi", "COOKING", 3200, "desi_murgha_karahi"),
  halfKg(
    "Chicken Lahori Karahi (Red Chilli)",
    "Chicken Karahi",
    "COOKING",
    1800,
    "chicken_lahori_karahi"
  ),
  fullKg(
    "Chicken Lahori Karahi (Red Chilli)",
    "Chicken Karahi",
    "COOKING",
    1700,
    "chicken_lahori_karahi"
  ),
  halfKg(
    "Chicken Karahi (Black Pepper)",
    "Chicken Karahi",
    "COOKING",
    1900,
    "chicken_black_pepper_karahi"
  ),
  fullKg(
    "Chicken Karahi (Black Pepper)",
    "Chicken Karahi",
    "COOKING",
    1800,
    "chicken_black_pepper_karahi"
  ),
  halfKg("Chicken Afghani Karahi (White)", "Chicken Karahi", "COOKING", 1900, "chicken_afghani_handi"),
  fullKg("Chicken Afghani Karahi (White)", "Chicken Karahi", "COOKING", 1800, "chicken_afghani_handi"),
  halfKg("Chicken Achari Karahi", "Chicken Karahi", "COOKING", 1900, "chicken_achari_karahi"),
  fullKg("Chicken Achari Karahi", "Chicken Karahi", "COOKING", 1800, "chicken_achari_karahi"),
  halfKg(
    "Chicken Peshawari Karahi (Shinwari)",
    "Chicken Karahi",
    "COOKING",
    1800,
    "chicken_shinwari_karahi"
  ),
  fullKg(
    "Chicken Peshawari Karahi (Shinwari)",
    "Chicken Karahi",
    "COOKING",
    1700,
    "chicken_shinwari_karahi"
  ),

  // Beef Karahi — PDF 1300|2500
  halfKg(
    "Quetta Sangat Special Beef Karahi",
    "Beef Karahi",
    "COOKING",
    2600,
    "sangat_beef_karahi"
  ),
  fullKg(
    "Quetta Sangat Special Beef Karahi",
    "Beef Karahi",
    "COOKING",
    2500,
    "sangat_beef_karahi"
  ),
  halfKg("Beef Lahori Karahi (Red Chilli)", "Beef Karahi", "COOKING", 2600, "beef_lahori_karahi"),
  fullKg("Beef Lahori Karahi (Red Chilli)", "Beef Karahi", "COOKING", 2500, "beef_lahori_karahi"),
  halfKg("Beef Karahi (Black Pepper)", "Beef Karahi", "COOKING", 2600, "beef_black_pepper_karahi"),
  fullKg("Beef Karahi (Black Pepper)", "Beef Karahi", "COOKING", 2500, "beef_black_pepper_karahi"),
  halfKg("Beef Afghani Karahi (White)", "Beef Karahi", "COOKING", 2600, "beef_afghani_karahi"),
  fullKg("Beef Afghani Karahi (White)", "Beef Karahi", "COOKING", 2500, "beef_afghani_karahi"),

  // Mutton Karahi — PDF 2100|4000, 2000|3800, 2100|4000, 2200|4100
  halfKg(
    "Quetta Sangat Special Mutton Karahi",
    "Mutton Karahi",
    "COOKING",
    4200,
    "sangat_mutton_karahi"
  ),
  fullKg(
    "Quetta Sangat Special Mutton Karahi",
    "Mutton Karahi",
    "COOKING",
    4000,
    "sangat_mutton_karahi"
  ),
  halfKg(
    "Mutton Lahori Karahi (Red Chilli)",
    "Mutton Karahi",
    "COOKING",
    4000,
    "mutton_lahori_karahi"
  ),
  fullKg(
    "Mutton Lahori Karahi (Red Chilli)",
    "Mutton Karahi",
    "COOKING",
    3800,
    "mutton_lahori_karahi"
  ),
  halfKg(
    "Mutton Karahi (Black Pepper)",
    "Mutton Karahi",
    "COOKING",
    4000,
    "mutton_black_pepper_karahi"
  ),
  fullKg(
    "Mutton Karahi (Black Pepper)",
    "Mutton Karahi",
    "COOKING",
    3800,
    "mutton_black_pepper_karahi"
  ),
  halfKg("Mutton Afghani Karahi (White)", "Mutton Karahi", "COOKING", 4200, "mutton_afghani_karahi"),
  fullKg("Mutton Afghani Karahi (White)", "Mutton Karahi", "COOKING", 4000, "mutton_afghani_karahi"),
  halfKg(
    "Mutton Peshawari Karahi (Shinwari)",
    "Mutton Karahi",
    "COOKING",
    4400,
    "mutton_peshawari_karahi"
  ),
  fullKg(
    "Mutton Peshawari Karahi (Shinwari)",
    "Mutton Karahi",
    "COOKING",
    4100,
    "mutton_peshawari_karahi"
  ),

  // Mutton Handi — PDF 2200|4100, 2200|4100, 2250|4300, 2200|4100
  halfKg(
    "Special Mutton Handi (With Bone)",
    "Mutton Handi",
    "COOKING",
    4400,
    "special_mutton_handi"
  ),
  fullHandiKg(
    "Special Mutton Handi (With Bone)",
    "Mutton Handi",
    "COOKING",
    4100,
    "special_mutton_handi"
  ),
  halfKg("Mutton Handi (With Bone)", "Mutton Handi", "COOKING", 4400, "mutton_handi"),
  fullHandiKg("Mutton Handi (With Bone)", "Mutton Handi", "COOKING", 4100, "mutton_handi"),
  halfKg(
    "Mutton Hari Mirch Handi (With Bone)",
    "Mutton Handi",
    "COOKING",
    4500,
    "mutton_hari_mirch_handi"
  ),
  fullHandiKg(
    "Mutton Hari Mirch Handi (With Bone)",
    "Mutton Handi",
    "COOKING",
    4300,
    "mutton_hari_mirch_handi"
  ),
  halfKg(
    "Mutton Afghani Handi (White / With Bone)",
    "Mutton Handi",
    "COOKING",
    4400,
    "mutton_afghani_handi"
  ),
  fullHandiKg(
    "Mutton Afghani Handi (White / With Bone)",
    "Mutton Handi",
    "COOKING",
    4100,
    "mutton_afghani_handi"
  ),

  // Chicken Handi — PDF 1000|1900, 900|1700, |1200, 950|1900, 950|1750
  halfKg(
    "Quetta Sangat Special Chicken Handi",
    "Chicken Handi",
    "COOKING",
    2000,
    "sangat_chicken_handi"
  ),
  fullHandiKg(
    "Quetta Sangat Special Chicken Handi",
    "Chicken Handi",
    "COOKING",
    1900,
    "sangat_chicken_handi"
  ),
  halfKg("Chicken Handi", "Chicken Handi", "COOKING", 1800, "chicken_handi"),
  fullHandiKg("Chicken Handi", "Chicken Handi", "COOKING", 1700, "chicken_handi"),
  // Hari Mirch — card full only 1200
  fullHandiKg(
    "Chicken Hari Mirch Handi",
    "Chicken Handi",
    "COOKING",
    1200,
    "chicken_hari_mirch_handi"
  ),
  halfKg("Chicken Afghani Handi (White)", "Chicken Handi", "COOKING", 1900, "chicken_afghani_handi"),
  fullHandiKg(
    "Chicken Afghani Handi (White)",
    "Chicken Handi",
    "COOKING",
    1900,
    "chicken_afghani_handi"
  ),
  halfKg("Chicken Achari Handi", "Chicken Handi", "COOKING", 1900, "chicken_achari_handi"),
  fullHandiKg("Chicken Achari Handi", "Chicken Handi", "COOKING", 1750, "chicken_achari_handi"),
  {
    name: "Chicken Jalfrezi",
    category: "Chicken Handi",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 900,
    recipeKey: "chicken_jalfrezi",
    ...PCS_FIXED,
  },
  {
    name: "Chicken Chatkhara",
    category: "Chicken Handi",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 900,
    recipeKey: "chicken_chatkhara",
    ...PCS_FIXED,
  },
  {
    name: "Chicken Ginger",
    category: "Chicken Handi",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 1000,
    recipeKey: "chicken_ginger",
    ...PCS_FIXED,
  },

  // Chinese Rice (plate portions)
  ...halfFull(
    "Quetta Sangat Special Rice",
    "Chinese Rice",
    "COOKING",
    450,
    900,
    "sangat_special_rice"
  ),
  ...halfFull("Chicken Fried Rice", "Chinese Rice", "COOKING", 400, 800, "chicken_fried_rice"),
  ...halfFull("Chicken Masala Rice", "Chinese Rice", "COOKING", 400, 800, "chicken_masala_rice"),
  ...halfFull("Egg Fried Rice", "Chinese Rice", "COOKING", 350, 700, "egg_fried_rice"),
  ...halfFull("Vegetable Rice", "Chinese Rice", "COOKING", 350, 700, "vegetable_rice"),

  // Chinese Combo
  {
    name: "Chicken Manchurian + Fried Rice",
    category: "Chinese Combo",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 1050,
    recipeKey: "chicken_manchurian_fried_rice",
  },
  {
    name: "Chicken Garlic + Fried Rice",
    category: "Chinese Combo",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 800,
    recipeKey: "chicken_garlic_fried_rice",
  },
  {
    name: "Chicken Black Pepper + Fried Rice",
    category: "Chinese Combo",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 800,
    recipeKey: "chicken_black_pepper_fried_rice",
  },

  // Salad
  {
    name: "Green Salad",
    category: "Salad",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 100,
    recipeKey: "green_salad",
  },
  {
    name: "Kachumar Salad",
    category: "Salad",
    station: "COOKING",
    unit: UnitType.PCS,
    price: 120,
    recipeKey: "kachumar_salad",
  },

  // Cold drinks — PDF lists names only (no Rs); Chaye Khana rates from card
  {
    name: "Regular Cold Drink",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 80,
    recipeKey: "regular_cold_drink",
    ...PCS_FIXED,
  },
  {
    name: "Can Pack",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 120,
    recipeKey: "can_pack",
    ...PCS_FIXED,
  },
  {
    name: "Can Pack (Sugar Free)",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 130,
    recipeKey: "can_pack_sf",
    ...PCS_FIXED,
  },
  {
    name: "1 Litre Drink",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 180,
    recipeKey: "drink_1l",
    ...PCS_FIXED,
  },
  {
    name: "1.5 Litre Drink",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 220,
    recipeKey: "drink_1_5l",
    ...PCS_FIXED,
  },
  {
    name: "2 Litre Drink",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 280,
    recipeKey: "drink_2l",
    ...PCS_FIXED,
  },
  {
    name: "Mineral Water (Small)",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 50,
    recipeKey: "water_small",
    ...PCS_FIXED,
  },
  {
    name: "Mineral Water (Large)",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 100,
    recipeKey: "water_large",
    ...PCS_FIXED,
  },
  {
    name: "Quetta Sangat Special Doodh Patti",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 70,
    recipeKey: "doodh_patti",
    ...PCS_FIXED,
  },
  {
    name: "Gur Wali Chaye",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 100,
    recipeKey: "gur_wali_chaye",
    ...PCS_FIXED,
  },
  {
    name: "Green Tea",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 70,
    recipeKey: "green_tea_cup",
    ...PCS_FIXED,
  },
  {
    name: "Sulaimani Qehwa",
    category: "Beverages",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 70,
    recipeKey: "sulaimani_qehwa",
    ...PCS_FIXED,
  },

  // Counter grocery (box/carton in store → piece / packet / pack on menu)
  {
    name: "Biscuit",
    category: "Grocery",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 20,
    recipeKey: "biscuit_1pc",
    ...PCS_FIXED,
  },
  {
    name: "Nimko",
    category: "Grocery",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 50,
    recipeKey: "nimko_1pk",
    ...PCS_FIXED,
  },
  {
    name: "Cigarette (Full)",
    category: "Grocery",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 500,
    recipeKey: "cigarette_full",
    ...PCS_FIXED,
  },
  {
    name: "Cigarette (Half)",
    category: "Grocery",
    station: "BEVERAGES",
    unit: UnitType.PCS,
    price: 260,
    recipeKey: "cigarette_half",
    ...PCS_FIXED,
  },
];

const RECIPE_CATEGORIES = [
  "Live Kitchen",
  "Breakfast & Paratha",
  "BBQ",
  "Karahi & Handi",
  "Chinese",
  "Chaye Khana",
  "Pakistani Special",
  "Chicken Karahi",
  "Beef Karahi",
  "Mutton Karahi",
  "Mutton Handi",
  "Chicken Handi",
  "Chinese Rice",
  "Chinese Combo",
  "Salad",
  "Beverages",
  "Grocery",
  "Appetizers",
];

type Ing = { key: string; quantity: number; unit: UnitType };
type RecipeDef = {
  key: string;
  name: string;
  category: string;
  baseUnit: UnitType;
  baseQty: number;
  prepMinutes?: number;
  ingredients: Ing[];
};

/** tbsp≈15g/ml, tsp≈5g — normalized for stock deduct. Water skipped. */
const CORE_RECIPES: RecipeDef[] = [
  {
    key: "chicken_shinwari_karahi",
    name: "Chicken Shinwari Karahi",
    category: "Karahi & Handi",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 25,
    ingredients: [
      { key: "chicken", quantity: 1, unit: UnitType.KG },
      { key: "tomato", quantity: 500, unit: UnitType.G },
      { key: "oil", quantity: 150, unit: UnitType.ML },
      { key: "garlic_paste", quantity: 22, unit: UnitType.G },
      { key: "green_chilli", quantity: 60, unit: UnitType.G },
      { key: "salt", quantity: 8, unit: UnitType.G },
      { key: "black_pepper", quantity: 10, unit: UnitType.G },
      { key: "ginger", quantity: 20, unit: UnitType.G },
    ],
  },
  {
    key: "bannu_beef_pulao",
    name: "Bannu Beef Pulao",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 40,
    ingredients: [
      { key: "beef", quantity: 1, unit: UnitType.KG },
      { key: "rice", quantity: 1, unit: UnitType.KG },
      { key: "ghee", quantity: 200, unit: UnitType.G },
      { key: "onion", quantity: 300, unit: UnitType.G },
      { key: "tomato", quantity: 200, unit: UnitType.G },
      { key: "garlic", quantity: 50, unit: UnitType.G },
      { key: "ginger", quantity: 30, unit: UnitType.G },
      { key: "coriander_seeds", quantity: 20, unit: UnitType.G },
      { key: "fennel", quantity: 20, unit: UnitType.G },
      { key: "whole_garam", quantity: 15, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 10, unit: UnitType.G },
      { key: "green_chilli", quantity: 70, unit: UnitType.G },
      { key: "salt", quantity: 45, unit: UnitType.G },
    ],
  },
  {
    key: "mutton_namkeen_rosh",
    name: "Mutton Namkeen Rosh",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 35,
    ingredients: [
      { key: "mutton", quantity: 1, unit: UnitType.KG },
      { key: "garlic", quantity: 100, unit: UnitType.G },
      { key: "ginger", quantity: 40, unit: UnitType.G },
      { key: "green_chilli", quantity: 40, unit: UnitType.G },
      { key: "black_pepper", quantity: 5, unit: UnitType.G },
      { key: "salt", quantity: 15, unit: UnitType.G },
    ],
  },
  {
    key: "special_chicken_paratha",
    name: "Special Chicken Paratha",
    category: "Breakfast & Paratha",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    prepMinutes: 12,
    ingredients: [
      { key: "flour", quantity: 280, unit: UnitType.G },
      { key: "chicken_breast", quantity: 200, unit: UnitType.G },
      { key: "onion", quantity: 50, unit: UnitType.G },
      { key: "green_chilli", quantity: 20, unit: UnitType.G },
      { key: "coriander", quantity: 10, unit: UnitType.G },
      { key: "cumin", quantity: 2, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 3, unit: UnitType.G },
      { key: "chaat_masala", quantity: 2, unit: UnitType.G },
      { key: "salt", quantity: 4, unit: UnitType.G },
      { key: "ghee", quantity: 60, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_malai_boti",
    name: "Chicken Malai Boti",
    category: "BBQ",
    baseUnit: UnitType.PCS,
    baseQty: 4,
    prepMinutes: 16,
    ingredients: [
      { key: "chicken_boneless", quantity: 500, unit: UnitType.G },
      { key: "cream", quantity: 50, unit: UnitType.ML },
      { key: "yogurt", quantity: 40, unit: UnitType.G },
      { key: "ginger_garlic", quantity: 15, unit: UnitType.G },
      { key: "green_chilli_paste", quantity: 15, unit: UnitType.G },
      { key: "white_pepper", quantity: 3, unit: UnitType.G },
      { key: "cornstarch", quantity: 5, unit: UnitType.G },
      { key: "lemon", quantity: 1, unit: UnitType.PCS },
      { key: "salt", quantity: 5, unit: UnitType.G },
      { key: "butter", quantity: 45, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_seekh_kabab",
    name: "Chicken Seekh Kabab",
    category: "BBQ",
    baseUnit: UnitType.PCS,
    baseQty: 7,
    prepMinutes: 16,
    ingredients: [
      { key: "chicken_mince", quantity: 500, unit: UnitType.G },
      { key: "onion", quantity: 120, unit: UnitType.G },
      { key: "ginger_garlic", quantity: 15, unit: UnitType.G },
      { key: "green_chilli", quantity: 30, unit: UnitType.G },
      { key: "coriander", quantity: 10, unit: UnitType.G },
      { key: "mint", quantity: 5, unit: UnitType.G },
      { key: "besan", quantity: 20, unit: UnitType.G },
      { key: "coriander_seeds", quantity: 10, unit: UnitType.G },
      { key: "cumin", quantity: 3, unit: UnitType.G },
      { key: "garam_masala", quantity: 3, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 5, unit: UnitType.G },
      { key: "salt", quantity: 5, unit: UnitType.G },
      { key: "oil", quantity: 30, unit: UnitType.ML },
    ],
  },
  {
    key: "chicken_afghani_handi",
    name: "Chicken Afghani White Handi",
    category: "Karahi & Handi",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 25,
    ingredients: [
      { key: "chicken_boneless", quantity: 1, unit: UnitType.KG },
      { key: "oil", quantity: 120, unit: UnitType.ML },
      { key: "butter", quantity: 60, unit: UnitType.G },
      { key: "ginger_garlic", quantity: 44, unit: UnitType.G },
      { key: "yogurt", quantity: 300, unit: UnitType.G },
      { key: "cream", quantity: 200, unit: UnitType.ML },
      { key: "white_pepper", quantity: 6, unit: UnitType.G },
      { key: "black_pepper", quantity: 4, unit: UnitType.G },
      { key: "cumin", quantity: 6, unit: UnitType.G },
      { key: "coriander_powder", quantity: 6, unit: UnitType.G },
      { key: "salt", quantity: 10, unit: UnitType.G },
      { key: "green_chilli", quantity: 80, unit: UnitType.G },
      { key: "kasoori_methi", quantity: 4, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_manchurian_fried_rice",
    name: "Chicken Manchurian with Egg Fried Rice",
    category: "Chinese",
    baseUnit: UnitType.PCS,
    baseQty: 1,
    prepMinutes: 20,
    ingredients: [
      { key: "chicken_boneless", quantity: 300, unit: UnitType.G },
      { key: "egg", quantity: 2.5, unit: UnitType.PCS },
      { key: "cornstarch", quantity: 30, unit: UnitType.G },
      { key: "garlic", quantity: 15, unit: UnitType.G },
      { key: "capsicum", quantity: 80, unit: UnitType.G },
      { key: "onion", quantity: 80, unit: UnitType.G },
      { key: "ketchup", quantity: 75, unit: UnitType.ML },
      { key: "chilli_garlic_sauce", quantity: 45, unit: UnitType.ML },
      { key: "soy", quantity: 45, unit: UnitType.ML },
      { key: "vinegar", quantity: 15, unit: UnitType.ML },
      { key: "oil", quantity: 80, unit: UnitType.ML },
      { key: "rice", quantity: 350, unit: UnitType.G },
      { key: "carrot", quantity: 30, unit: UnitType.G },
      { key: "cabbage", quantity: 30, unit: UnitType.G },
      { key: "spring_onion", quantity: 20, unit: UnitType.G },
      { key: "white_pepper", quantity: 2, unit: UnitType.G },
      { key: "salt", quantity: 3, unit: UnitType.G },
    ],
  },
  {
    key: "doodh_patti",
    name: "Quetta Sangat Special Doodh Patti",
    category: "Chaye Khana",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    prepMinutes: 5,
    ingredients: [
      { key: "milk", quantity: 400, unit: UnitType.ML },
      { key: "tea", quantity: 8, unit: UnitType.G },
      { key: "cardamom", quantity: 2, unit: UnitType.G },
      { key: "sugar", quantity: 10, unit: UnitType.G },
    ],
  },
  {
    key: "gur_wali_chaye",
    name: "Gur Wali Chaye",
    category: "Chaye Khana",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    prepMinutes: 5,
    ingredients: [
      { key: "milk", quantity: 350, unit: UnitType.ML },
      { key: "gur", quantity: 35, unit: UnitType.G },
      { key: "tea", quantity: 6, unit: UnitType.G },
      { key: "cardamom", quantity: 2, unit: UnitType.G },
      { key: "fennel", quantity: 1, unit: UnitType.G },
    ],
  },
  {
    key: "sulaimani_qehwa",
    name: "Sulaimani Qehwa",
    category: "Chaye Khana",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    prepMinutes: 4,
    ingredients: [
      { key: "green_tea", quantity: 3, unit: UnitType.G },
      { key: "cardamom", quantity: 2, unit: UnitType.G },
      { key: "cinnamon", quantity: 3, unit: UnitType.G },
      { key: "lemon", quantity: 0.25, unit: UnitType.PCS },
      { key: "honey", quantity: 10, unit: UnitType.G },
    ],
  },
  {
    key: "special_shahi_daal",
    name: "Special Shahi Daal",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 30,
    ingredients: [
      { key: "onion", quantity: 150, unit: UnitType.G },
      { key: "tomato", quantity: 100, unit: UnitType.G },
      { key: "oil", quantity: 80, unit: UnitType.ML },
      { key: "garlic", quantity: 20, unit: UnitType.G },
      { key: "ginger", quantity: 15, unit: UnitType.G },
      { key: "salt", quantity: 12, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 8, unit: UnitType.G },
      { key: "butter", quantity: 40, unit: UnitType.G },
    ],
  },
  {
    key: "special_mix_vegetable",
    name: "Special Mix Vegetable",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 25,
    ingredients: [
      { key: "potato", quantity: 300, unit: UnitType.G },
      { key: "carrot", quantity: 150, unit: UnitType.G },
      { key: "capsicum", quantity: 100, unit: UnitType.G },
      { key: "onion", quantity: 120, unit: UnitType.G },
      { key: "tomato", quantity: 100, unit: UnitType.G },
      { key: "oil", quantity: 60, unit: UnitType.ML },
      { key: "salt", quantity: 10, unit: UnitType.G },
    ],
  },
  {
    key: "special_daal_moong",
    name: "Special Daal Moong",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 25,
    ingredients: [
      { key: "onion", quantity: 100, unit: UnitType.G },
      { key: "tomato", quantity: 80, unit: UnitType.G },
      { key: "oil", quantity: 50, unit: UnitType.ML },
      { key: "garlic", quantity: 15, unit: UnitType.G },
      { key: "salt", quantity: 10, unit: UnitType.G },
      { key: "cumin", quantity: 5, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_qorma",
    name: "Chicken Qorma",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 30,
    ingredients: [
      { key: "chicken", quantity: 1, unit: UnitType.KG },
      { key: "yogurt", quantity: 200, unit: UnitType.G },
      { key: "onion", quantity: 250, unit: UnitType.G },
      { key: "oil", quantity: 100, unit: UnitType.ML },
      { key: "garlic_paste", quantity: 30, unit: UnitType.G },
      { key: "ginger", quantity: 25, unit: UnitType.G },
      { key: "garam_masala", quantity: 8, unit: UnitType.G },
      { key: "salt", quantity: 12, unit: UnitType.G },
    ],
  },
  {
    key: "special_daal_mash",
    name: "Special Daal Mash",
    category: "Pakistani Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    prepMinutes: 25,
    ingredients: [
      { key: "onion", quantity: 100, unit: UnitType.G },
      { key: "tomato", quantity: 80, unit: UnitType.G },
      { key: "oil", quantity: 50, unit: UnitType.ML },
      { key: "garlic", quantity: 15, unit: UnitType.G },
      { key: "salt", quantity: 10, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 6, unit: UnitType.G },
    ],
  },
  {
    key: "biscuit_1pc",
    name: "Biscuit (1 piece)",
    category: "Grocery",
    baseUnit: UnitType.PCS,
    baseQty: 1,
    prepMinutes: 1,
    ingredients: [{ key: "biscuit", quantity: 1, unit: UnitType.PCS }],
  },
  {
    key: "nimko_1pk",
    name: "Nimko (1 packet)",
    category: "Grocery",
    baseUnit: UnitType.PCS,
    baseQty: 1,
    prepMinutes: 1,
    ingredients: [{ key: "nimko", quantity: 1, unit: UnitType.PCS }],
  },
  {
    key: "cigarette_full",
    name: "Cigarette (Full pack)",
    category: "Grocery",
    baseUnit: UnitType.PCS,
    baseQty: 1,
    prepMinutes: 1,
    ingredients: [{ key: "cigarette", quantity: 1, unit: UnitType.PCS }],
  },
  {
    key: "cigarette_half",
    name: "Cigarette (Half pack)",
    category: "Grocery",
    baseUnit: UnitType.PCS,
    baseQty: 1,
    prepMinutes: 1,
    ingredients: [{ key: "cigarette", quantity: 0.5, unit: UnitType.PCS }],
  },
];

/** Core + full menu catalog (menu Half/Full share one recipe key). */
const RECIPES: RecipeDef[] = (() => {
  const byKey = new Map<string, RecipeDef>();
  for (const def of [...CORE_RECIPES, ...FULL_MENU_RECIPES]) {
    byKey.set(def.key, def);
  }
  return [...byKey.values()];
})();

/**
 * Daily pots (Specials page). sellMode BOTH = plate + Rs.
 * halfPlatePrice set → menu Half (0.5× plateGrams) + Full (1×); else single serving.
 */
const SPECIAL_PRODUCTS: {
  name: string;
  category: string;
  platePrice: number;
  plateGrams: number;
  cookRecipeKey: string;
  /** Card half plate Rs; omit = single size only */
  halfPlatePrice?: number;
}[] = [
  {
    name: "Bannu Palao",
    category: "Pakistani Special",
    platePrice: 1000,
    plateGrams: 1000,
    cookRecipeKey: "bannu_beef_pulao",
  },
  {
    name: "Mutton Namkeen Rosh",
    category: "Pakistani Special",
    platePrice: 550,
    plateGrams: 350,
    cookRecipeKey: "mutton_namkeen_rosh",
  },
  {
    name: "Special Shahi Daal",
    category: "Pakistani Special",
    platePrice: 550,
    plateGrams: 350,
    cookRecipeKey: "special_shahi_daal",
  },
  {
    name: "Special Mix Vegetable",
    category: "Pakistani Special",
    platePrice: 400,
    plateGrams: 350,
    cookRecipeKey: "special_mix_vegetable",
  },
  {
    name: "Special Daal Moong",
    category: "Pakistani Special",
    platePrice: 200,
    plateGrams: 400,
    halfPlatePrice: 120,
    cookRecipeKey: "special_daal_moong",
  },
  {
    name: "Chicken Qorma",
    category: "Pakistani Special",
    platePrice: 280,
    plateGrams: 400,
    halfPlatePrice: 180,
    cookRecipeKey: "chicken_qorma",
  },
  {
    name: "Special Daal Mash",
    category: "Pakistani Special",
    platePrice: 250,
    plateGrams: 400,
    halfPlatePrice: 150,
    cookRecipeKey: "special_daal_mash",
  },
];

async function upsertStoreItem(categoryId: string, def: StoreDef) {
  const packUnit = def.packUnit ?? PackUnit.NONE;
  const unitsPerPack = packUnit === PackUnit.NONE ? 1 : Math.max(1, def.unitsPerPack ?? 1);
  return prisma.storeItem.upsert({
    where: { categoryId_name: { categoryId, name: def.name } },
    update: {
      unit: def.unit,
      packUnit,
      unitsPerPack,
      quantityOnHand: def.qty,
      ratePerUnit: def.rate,
      reorderLevel: def.reorder ?? 1,
      active: true,
    },
    create: {
      name: def.name,
      categoryId,
      unit: def.unit,
      packUnit,
      unitsPerPack,
      quantityOnHand: def.qty,
      ratePerUnit: def.rate,
      reorderLevel: def.reorder ?? 1,
    },
  });
}

async function ensureRecipe(
  def: RecipeDef,
  storeIds: Record<string, string>
) {
  // Merge duplicate store lines (helpers sometimes re-add the same key).
  const merged = new Map<string, { storeItemId: string; quantity: number; unit: UnitType }>();
  for (const i of def.ingredients) {
    const storeItemId = storeIds[i.key];
    if (!storeItemId) throw new Error(`Missing store item key: ${i.key} (recipe ${def.key})`);
    const prev = merged.get(storeItemId);
    if (prev) {
      if (prev.unit !== i.unit) {
        throw new Error(`Recipe ${def.key}: unit clash for ${i.key}`);
      }
      prev.quantity += i.quantity;
    } else {
      merged.set(storeItemId, { storeItemId, quantity: i.quantity, unit: i.unit });
    }
  }
  const ingredients = [...merged.values()];

  const prepMinutes = def.prepMinutes ?? 15;
  const existing = await prisma.recipe.findUnique({ where: { name: def.name } });
  if (existing) {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
    return prisma.recipe.update({
      where: { id: existing.id },
      data: {
        category: def.category,
        baseUnit: def.baseUnit,
        baseQty: def.baseQty,
        prepMinutes,
        active: true,
        ingredients: { create: ingredients },
      },
    });
  }
  return prisma.recipe.create({
    data: {
      name: def.name,
      category: def.category,
      baseUnit: def.baseUnit,
      baseQty: def.baseQty,
      prepMinutes,
      ingredients: { create: ingredients },
    },
  });
}

const PARTITIONS: { name: string; sortOrder: number; tableCount: number }[] = [
  { name: "Hall", sortOrder: 1, tableCount: 15 },
  { name: "Lawn", sortOrder: 2, tableCount: 10 },
  { name: "Roof Top", sortOrder: 3, tableCount: 8 },
];

async function ensurePartitionTables(partitionId: string, area: string, count: number) {
  const have = new Set(
    (await prisma.restaurantTable.findMany({ where: { partitionId }, select: { name: true } })).map(
      (t) => t.name
    )
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

async function seedCatalog() {
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  // Older DBs may still have global unique(name); partitions need per-partition names.
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "RestaurantTable_name_key"`);

  for (const p of PARTITIONS) {
    const part =
      (await prisma.tablePartition.findUnique({ where: { name: p.name } })) ??
      (await prisma.tablePartition.create({
        data: { name: p.name, sortOrder: p.sortOrder, active: true },
      }));
    if (part.sortOrder !== p.sortOrder || !part.active) {
      await prisma.tablePartition.update({
        where: { id: part.id },
        data: { sortOrder: p.sortOrder, active: true },
      });
    }
    await ensurePartitionTables(part.id, p.name, p.tableCount);
  }

  for (const name of RECIPE_CATEGORIES) {
    await prisma.recipeCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  for (const c of [
    { code: "FRESH", name: "Fresh", sortOrder: 1 },
    { code: "DRY", name: "Dry", sortOrder: 2 },
    { code: "LIQUID", name: "Liquid", sortOrder: 3 },
    { code: "GROCERY", name: "Grocery", sortOrder: 4 },
  ]) {
    await prisma.storeCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: c,
    });
  }

  const cats = {
    FRESH: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "FRESH" } }),
    DRY: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "DRY" } }),
    LIQUID: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "LIQUID" } }),
    GROCERY: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "GROCERY" } }),
  };

  const storeIds: Record<string, string> = {};
  for (const def of STORE_ITEMS) {
    const row = await upsertStoreItem(cats[def.cat].id, def);
    storeIds[def.key] = row.id;
  }

  const recipeIds: Record<string, string> = {};
  for (const def of RECIPES) {
    const row = await ensureRecipe(def, storeIds);
    recipeIds[def.key] = row.id;
  }

  for (const m of MENU) {
    if (m.recipeKey && !recipeIds[m.recipeKey]) {
      throw new Error(`Menu "${m.name}" recipeKey missing: ${m.recipeKey}`);
    }
  }

  // Upsert demo/catalog menu rows only — never delete or disable restaurant-owned items.
  // (Older seed versions wiped anything not in MENU; that destroyed live hotel menus.)
  const existingMenu = await prisma.menuItem.findMany({ select: { id: true, name: true, category: true } });
  const byKey = new Map(existingMenu.map((m) => [`${m.category ?? ""}::${m.name}`, m.id]));

  for (const m of MENU) {
    const key = `${m.category}::${m.name}`;
    const recipeId = m.recipeKey ? recipeIds[m.recipeKey] ?? null : null;
    const pcsDefault = m.unit === UnitType.PCS;
    const qty = {
      minQty: m.minQty ?? (pcsDefault ? 1 : 0),
      maxQty: m.maxQty === undefined ? null : m.maxQty,
      qtyStep: m.qtyStep === undefined ? (pcsDefault ? 1 : null) : m.qtyStep,
      allowCustomQty: m.allowCustomQty ?? !pcsDefault,
    };
    const id = byKey.get(key);
    if (id) {
      await prisma.menuItem.update({
        where: { id },
        data: {
          kitchenStation: m.station,
          sellUnit: m.unit,
          sellingPrice: m.price,
          recipeId,
          ...qty,
          active: true,
        },
      });
    } else {
      const created = await prisma.menuItem.create({
        data: {
          name: m.name,
          category: m.category,
          kitchenStation: m.station,
          sellUnit: m.unit,
          sellingPrice: m.price,
          recipeId,
          ...qty,
        },
      });
      byKey.set(key, created.id);
    }
  }

  // Hide old category duplicates + Live Kitchen Banu (pots live under Pakistani Special).
  await prisma.menuItem.updateMany({
    where: {
      OR: [
        { category: { in: ["Quetta Sangat Special", "Daal & Sabzi", "Special Pakistani"] } },
        { name: { in: ["Banu Pulao", "Bannu Palao", "Bannu Beef Pulao"] }, category: "Live Kitchen" },
        // NORMAL Bannu KG row — sell via pot SPECIAL instead
        { name: "Bannu Palao", kind: "NORMAL", category: "Pakistani Special" },
        { name: "Bannu Palao", kind: "NORMAL", category: "Special Pakistani" },
      ],
      active: true,
    },
    data: { active: false },
  });
  // Drop lowercase duplicate pot if present
  await prisma.specialProduct.updateMany({
    where: { name: "bannu palao" },
    data: { active: false },
  });

  // Old single-line Karahi/Handi (before Half/Full split) — hide from waiter.
  const legacySingleLines = [
    "Quetta Sangat Special Chicken Karahi",
    "Special Desi Murgha Karahi",
    "Chicken Lahori Karahi (Red Chilli)",
    "Chicken Karahi (Black Pepper)",
    "Chicken Afghani Karahi (White)",
    "Chicken Achari Karahi",
    "Chicken Peshawari Karahi (Shinwari)",
    "Quetta Sangat Special Beef Karahi",
    "Beef Lahori Karahi (Red Chilli)",
    "Beef Karahi (Black Pepper)",
    "Beef Afghani Karahi (White)",
    "Quetta Sangat Special Mutton Karahi",
    "Mutton Lahori Karahi (Red Chilli)",
    "Mutton Karahi (Black Pepper)",
    "Mutton Afghani Karahi (White)",
    "Mutton Peshawari Karahi (Shinwari)",
    "Special Mutton Handi (With Bone)",
    "Mutton Handi (With Bone)",
    "Mutton Hari Mirch Handi (With Bone)",
    "Mutton Afghani Handi (White / With Bone)",
    "Quetta Sangat Special Chicken Handi",
    "Chicken Handi",
    "Chicken Hari Mirch Handi",
    "Chicken Afghani Handi (White)",
    "Chicken Achari Handi",
    // Old single-line namkeen (now Half/Full)
    "Mutton Namkeen Gosht Special",
    "Beef Namkeen Gosht",
  ];
  await prisma.menuItem.updateMany({
    where: {
      name: { in: legacySingleLines },
      active: true,
    },
    data: { active: false },
  });
  // Hari Mirch was full-only on card — hide leftover Half band
  await prisma.menuItem.updateMany({
    where: { name: "Chicken Hari Mirch Handi (Half)", active: true },
    data: { active: false },
  });

  // Special pots + SPECIAL menu (Half/Full when halfPlatePrice set; sellMode BOTH = plate + Rs)
  for (const sp of SPECIAL_PRODUCTS) {
    const cookRecipeId = recipeIds[sp.cookRecipeKey];
    if (!cookRecipeId) throw new Error(`Missing cook recipe key: ${sp.cookRecipeKey}`);
    const halfPlate =
      sp.halfPlatePrice != null && sp.halfPlatePrice > 0 ? sp.halfPlatePrice : null;
    const existing = await prisma.specialProduct.findUnique({ where: { name: sp.name } });
    const product = existing
      ? await prisma.specialProduct.update({
          where: { id: existing.id },
          data: {
            category: sp.category,
            platePrice: sp.platePrice,
            halfPlatePrice: halfPlate,
            plateGrams: sp.plateGrams,
            cookRecipeId,
            sellMode: "BOTH",
            servingLabel: "Plate",
            active: true,
          },
        })
      : await prisma.specialProduct.create({
          data: {
            name: sp.name,
            category: sp.category,
            platePrice: sp.platePrice,
            halfPlatePrice: halfPlate,
            plateGrams: sp.plateGrams,
            cookRecipeId,
            sellMode: "BOTH",
            servingLabel: "Plate",
          },
        });

    const baseMenu = {
      category: product.category,
      kitchenStation: "COOKING",
      kind: "SPECIAL" as const,
      sellUnit: UnitType.PCS,
      specialProductId: product.id,
      recipeId: null as string | null,
      listPortionQty: 1,
      minQty: 1,
      qtyStep: 1,
      allowCustomQty: false,
      active: true,
    };

    if (halfPlate != null) {
      const fullName = `${sp.name} (Full)`;
      const halfName = `${sp.name} (Half)`;
      const upsertPortion = async (name: string, price: number, mix: number) => {
        const row =
          (await prisma.menuItem.findFirst({
            where: { specialProductId: product.id, kind: "SPECIAL", name },
          })) ??
          (await prisma.menuItem.findFirst({
            where: { name, category: product.category, kind: "SPECIAL" },
          }));
        if (row) {
          await prisma.menuItem.update({
            where: { id: row.id },
            data: { ...baseMenu, name, sellingPrice: price, mixSpecialPlates: mix },
          });
        } else {
          await prisma.menuItem.create({
            data: { ...baseMenu, name, sellingPrice: price, mixSpecialPlates: mix },
          });
        }
      };
      await upsertPortion(fullName, sp.platePrice, 1);
      await upsertPortion(halfName, halfPlate, 0.5);
      // Hide bare pot name if leftover from older sync
      await prisma.menuItem.updateMany({
        where: {
          specialProductId: product.id,
          kind: "SPECIAL",
          name: sp.name,
          active: true,
        },
        data: { active: false },
      });
    } else {
      const menu = await prisma.menuItem.findFirst({
        where: { specialProductId: product.id, kind: "SPECIAL" },
        orderBy: { createdAt: "asc" },
      });
      if (menu) {
        await prisma.menuItem.update({
          where: { id: menu.id },
          data: {
            ...baseMenu,
            name: product.name,
            sellingPrice: sp.platePrice,
            mixSpecialPlates: 1,
          },
        });
      } else {
        await prisma.menuItem.create({
          data: {
            ...baseMenu,
            name: product.name,
            sellingPrice: sp.platePrice,
            mixSpecialPlates: 1,
          },
        });
      }
    }
  }

  // Hide old NORMAL daal/sabzi lines (now special pots)
  await prisma.menuItem.updateMany({
    where: {
      kind: "NORMAL",
      active: true,
      OR: [
        { name: { in: ["Special Shahi Daal", "Special Mix Vegetable"] } },
        { name: { startsWith: "Special Daal Moong" } },
        { name: { startsWith: "Chicken Qorma" } },
        { name: { startsWith: "Special Daal Mash" } },
      ],
    },
    data: { active: false },
  });

  const [tableCount, menuActive, menuKg] = await Promise.all([
    prisma.restaurantTable.count(),
    prisma.menuItem.count({ where: { active: true } }),
    prisma.menuItem.count({ where: { active: true, sellUnit: UnitType.KG } }),
  ]);
  return {
    store: STORE_ITEMS.length,
    recipes: RECIPES.length,
    specials: SPECIAL_PRODUCTS.length,
    menu: MENU.length,
    menuActive,
    menuKg,
    partitions: PARTITIONS.length,
    tables: tableCount,
  };
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
    { username: "sysmanager", name: "System Manager", pass: "sys123", pin: "5555", role: "SYSTEM_MANAGER" },
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

  const oldMgr = await prisma.user.findUnique({ where: { username: "manager" } });
  if (oldMgr) {
    await prisma.user.update({
      where: { id: oldMgr.id },
      data: {
        roleId: await roleId("SUPERVISOR"),
        name: oldMgr.name.includes("Manager") ? "Supervisor Usman" : oldMgr.name,
      },
    });
  }

  const catalog = await seedCatalog();
  console.log("Seed OK — Quetta Sangat catalog", catalog);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
