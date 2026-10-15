import { UnitType } from "@prisma/client";

type Ing = { key: string; quantity: number; unit: UnitType };

export type CatalogRecipe = {
  key: string;
  name: string;
  category: string;
  baseUnit: UnitType;
  baseQty: number;
  prepMinutes: number;
  ingredients: Ing[];
};

const G = UnitType.G;
const KG = UnitType.KG;
const ML = UnitType.ML;
const PCS = UnitType.PCS;

function r(
  key: string,
  name: string,
  category: string,
  baseUnit: UnitType,
  baseQty: number,
  prepMinutes: number,
  ingredients: Ing[]
): CatalogRecipe {
  return { key, name, category, baseUnit, baseQty, prepMinutes, ingredients };
}

function chickenKarahi(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Chicken Karahi", KG, 1, prepMinutes, [
    { key: "chicken", quantity: 1, unit: KG },
    { key: "tomato", quantity: 500, unit: G },
    { key: "oil", quantity: 150, unit: ML },
    { key: "garlic_paste", quantity: 22, unit: G },
    { key: "ginger", quantity: 20, unit: G },
    { key: "green_chilli", quantity: 50, unit: G },
    { key: "salt", quantity: 10, unit: G },
    ...extra,
  ]);
}

function beefKarahi(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Beef Karahi", KG, 1, prepMinutes, [
    { key: "beef", quantity: 1, unit: KG },
    { key: "tomato", quantity: 450, unit: G },
    { key: "oil", quantity: 140, unit: ML },
    { key: "garlic_paste", quantity: 25, unit: G },
    { key: "ginger", quantity: 25, unit: G },
    { key: "green_chilli", quantity: 50, unit: G },
    { key: "salt", quantity: 12, unit: G },
    ...extra,
  ]);
}

function muttonKarahi(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Mutton Karahi", KG, 1, prepMinutes, [
    { key: "mutton", quantity: 1, unit: KG },
    { key: "tomato", quantity: 450, unit: G },
    { key: "oil", quantity: 140, unit: ML },
    { key: "garlic_paste", quantity: 25, unit: G },
    { key: "ginger", quantity: 25, unit: G },
    { key: "green_chilli", quantity: 55, unit: G },
    { key: "salt", quantity: 12, unit: G },
    ...extra,
  ]);
}

function chickenHandi(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Chicken Handi", KG, 1, prepMinutes, [
    { key: "chicken_boneless", quantity: 1, unit: KG },
    { key: "oil", quantity: 100, unit: ML },
    { key: "butter", quantity: 40, unit: G },
    { key: "yogurt", quantity: 250, unit: G },
    { key: "ginger_garlic", quantity: 40, unit: G },
    { key: "onion", quantity: 150, unit: G },
    { key: "tomato", quantity: 120, unit: G },
    { key: "green_chilli", quantity: 60, unit: G },
    { key: "salt", quantity: 10, unit: G },
    ...extra,
  ]);
}

function muttonHandi(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Mutton Handi", KG, 1, prepMinutes, [
    { key: "mutton", quantity: 1, unit: KG },
    { key: "oil", quantity: 120, unit: ML },
    { key: "yogurt", quantity: 280, unit: G },
    { key: "ginger_garlic", quantity: 45, unit: G },
    { key: "onion", quantity: 180, unit: G },
    { key: "tomato", quantity: 100, unit: G },
    { key: "green_chilli", quantity: 70, unit: G },
    { key: "salt", quantity: 12, unit: G },
    ...extra,
  ]);
}

function chickenBbq(
  key: string,
  name: string,
  prepMinutes: number,
  meatKey: string,
  meatQty: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "BBQ", PCS, 1, prepMinutes, [
    { key: meatKey, quantity: meatQty, unit: G },
    { key: "yogurt", quantity: 40, unit: G },
    { key: "ginger_garlic", quantity: 15, unit: G },
    { key: "lemon", quantity: 0.5, unit: PCS },
    { key: "salt", quantity: 5, unit: G },
    { key: "chilli_flakes", quantity: 4, unit: G },
    { key: "oil", quantity: 20, unit: ML },
    ...extra,
  ]);
}

function friedRice(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Chinese Rice", PCS, 1, prepMinutes, [
    { key: "rice", quantity: 300, unit: G },
    { key: "oil", quantity: 40, unit: ML },
    { key: "soy", quantity: 20, unit: ML },
    { key: "salt", quantity: 3, unit: G },
    { key: "spring_onion", quantity: 20, unit: G },
    ...extra,
  ]);
}

function soup(
  key: string,
  name: string,
  prepMinutes: number,
  extra: Ing[] = []
): CatalogRecipe {
  return r(key, name, "Appetizers", PCS, 1, prepMinutes, [
    { key: "chicken", quantity: 80, unit: G },
    { key: "cornstarch", quantity: 15, unit: G },
    { key: "egg", quantity: 1, unit: PCS },
    { key: "salt", quantity: 3, unit: G },
    { key: "white_pepper", quantity: 1, unit: G },
    { key: "soy", quantity: 8, unit: ML },
    ...extra,
  ]);
}

function pcsDrink(key: string, name: string, storeKey: string, prepMinutes = 2): CatalogRecipe {
  return r(key, name, "Beverages", PCS, 1, prepMinutes, [
    { key: storeKey, quantity: 1, unit: PCS },
  ]);
}

/** Full catalog recipes for every seeded menu dish (shared across Half/Full lines). */
export const FULL_MENU_RECIPES: CatalogRecipe[] = [
  // —— Live Kitchen ——
  r("mutton_khada_sijji", "Mutton Khada Sijji", "Live Kitchen", PCS, 1, 45, [
    { key: "mutton", quantity: 2.5, unit: KG },
    { key: "salt", quantity: 40, unit: G },
    { key: "black_pepper", quantity: 15, unit: G },
    { key: "garlic", quantity: 80, unit: G },
    { key: "oil", quantity: 100, unit: ML },
  ]),
  r("ranjha_goshat", "Ranjha Goshat", "Live Kitchen", PCS, 1, 40, [
    { key: "mutton", quantity: 2, unit: KG },
    { key: "onion", quantity: 300, unit: G },
    { key: "tomato", quantity: 200, unit: G },
    { key: "oil", quantity: 120, unit: ML },
    { key: "ginger_garlic", quantity: 50, unit: G },
    { key: "salt", quantity: 20, unit: G },
    { key: "garam_masala", quantity: 10, unit: G },
  ]),
  r("chicken_khada_sijji", "Chicken Khada Sijji", "Live Kitchen", PCS, 1, 35, [
    { key: "chicken", quantity: 1.5, unit: KG },
    { key: "salt", quantity: 25, unit: G },
    { key: "black_pepper", quantity: 10, unit: G },
    { key: "garlic", quantity: 50, unit: G },
    { key: "oil", quantity: 80, unit: ML },
  ]),
  muttonKarahi("mutton_shinwari_karahi", "Mutton Shinwari Karahi", 30, [
    { key: "black_pepper", quantity: 12, unit: G },
  ]),
  r("dam_pukhat", "Dam Pukhat", "Live Kitchen", PCS, 1, 35, [
    { key: "mutton", quantity: 0.8, unit: KG },
    { key: "rice", quantity: 0.5, unit: KG },
    { key: "onion", quantity: 150, unit: G },
    { key: "ghee", quantity: 80, unit: G },
    { key: "whole_garam", quantity: 10, unit: G },
    { key: "salt", quantity: 12, unit: G },
  ]),
  chickenBbq("paneer_bbq", "Paneer BBQ", 12, "paneer", 200, [
    { key: "chaat_masala", quantity: 3, unit: G },
    { key: "capsicum", quantity: 40, unit: G },
  ]),
  chickenBbq("beef_bbq_live", "Beef BBQ (Live)", 18, "beef", 250, [
    { key: "black_pepper", quantity: 4, unit: G },
  ]),
  chickenBbq("afghani_boti_live", "Afghani Boti (Live)", 15, "chicken_boneless", 200, [
    { key: "cream", quantity: 30, unit: ML },
    { key: "white_pepper", quantity: 2, unit: G },
  ]),

  // —— Breakfast ——
  r("plain_paratha", "Plain Paratha", "Breakfast & Paratha", PCS, 1, 8, [
    { key: "flour", quantity: 80, unit: G },
    { key: "ghee", quantity: 15, unit: G },
    { key: "salt", quantity: 1, unit: G },
  ]),
  r("aloo_paratha", "Aloo Paratha", "Breakfast & Paratha", PCS, 1, 12, [
    { key: "flour", quantity: 90, unit: G },
    { key: "potato", quantity: 100, unit: G },
    { key: "onion", quantity: 20, unit: G },
    { key: "green_chilli", quantity: 8, unit: G },
    { key: "ghee", quantity: 20, unit: G },
    { key: "salt", quantity: 2, unit: G },
  ]),
  r("egg_paratha", "Egg Paratha", "Breakfast & Paratha", PCS, 1, 10, [
    { key: "flour", quantity: 80, unit: G },
    { key: "egg", quantity: 1, unit: PCS },
    { key: "ghee", quantity: 20, unit: G },
    { key: "salt", quantity: 2, unit: G },
  ]),
  r("omelette", "Omelette", "Breakfast & Paratha", PCS, 1, 8, [
    { key: "egg", quantity: 2, unit: PCS },
    { key: "onion", quantity: 30, unit: G },
    { key: "tomato", quantity: 30, unit: G },
    { key: "green_chilli", quantity: 10, unit: G },
    { key: "oil", quantity: 15, unit: ML },
    { key: "salt", quantity: 2, unit: G },
  ]),
  r("yogurt_bowl", "Yogurt Bowl", "Breakfast & Paratha", PCS, 1, 3, [
    { key: "yogurt", quantity: 200, unit: G },
  ]),

  // —— Appetizers ——
  soup("sangat_special_soup", "Quetta Sangat Special Soup", 12, [
    { key: "carrot", quantity: 20, unit: G },
    { key: "cabbage", quantity: 20, unit: G },
    { key: "vinegar", quantity: 5, unit: ML },
  ]),
  soup("chicken_hot_sour_soup", "Chicken Hot & Sour Soup", 12, [
    { key: "vinegar", quantity: 15, unit: ML },
    { key: "chilli_flakes", quantity: 3, unit: G },
  ]),
  soup("chicken_corn_soup", "Chicken Corn Soup", 12, [
    { key: "carrot", quantity: 15, unit: G },
  ]),
  soup("chicken_veg_soup", "Chicken Vegetable Soup", 12, [
    { key: "carrot", quantity: 25, unit: G },
    { key: "cabbage", quantity: 25, unit: G },
  ]),
  r("special_fries", "Quetta Sangat Special Fries", "Appetizers", PCS, 1, 12, [
    { key: "potato", quantity: 350, unit: G },
    { key: "oil", quantity: 80, unit: ML },
    { key: "salt", quantity: 4, unit: G },
    { key: "chaat_masala", quantity: 3, unit: G },
  ]),

  // —— BBQ ——
  chickenBbq("chicken_tikka_boti", "Chicken Tikka Boti", 15, "chicken_boneless", 180, [
    { key: "chaat_masala", quantity: 2, unit: G },
  ]),
  chickenBbq("chicken_kasturi_boti", "Chicken Kasturi Boti", 16, "chicken_boneless", 200, [
    { key: "kasoori_methi", quantity: 3, unit: G },
    { key: "cream", quantity: 25, unit: ML },
  ]),
  chickenBbq("chicken_afghani_boti", "Chicken Afghani Boti", 15, "chicken_boneless", 180, [
    { key: "cream", quantity: 30, unit: ML },
    { key: "white_pepper", quantity: 2, unit: G },
  ]),
  chickenBbq("chicken_makhmali_kabab", "Chicken Makhmali Kabab", 16, "chicken_mince", 180, [
    { key: "onion", quantity: 40, unit: G },
    { key: "besan", quantity: 10, unit: G },
  ]),
  chickenBbq("chicken_kalmi_tikka", "Chicken Kalmi Tikka", 20, "chicken", 350, [
    { key: "black_pepper", quantity: 4, unit: G },
  ]),
  chickenBbq("chicken_reshmi_kabab", "Chicken Reshmi Kabab", 16, "chicken_mince", 180, [
    { key: "cream", quantity: 30, unit: ML },
    { key: "onion", quantity: 40, unit: G },
  ]),
  r("beef_kabab", "Beef Kabab", "BBQ", PCS, 1, 18, [
    { key: "beef_mince", quantity: 180, unit: G },
    { key: "onion", quantity: 50, unit: G },
    { key: "ginger_garlic", quantity: 12, unit: G },
    { key: "green_chilli", quantity: 15, unit: G },
    { key: "coriander", quantity: 8, unit: G },
    { key: "salt", quantity: 4, unit: G },
    { key: "oil", quantity: 15, unit: ML },
  ]),
  chickenBbq("chicken_turkish_kabab", "Chicken Turkish Kabab", 16, "chicken_mince", 180, [
    { key: "capsicum", quantity: 30, unit: G },
    { key: "onion", quantity: 40, unit: G },
  ]),
  chickenBbq("chicken_tikka_chest", "Chicken Tikka Chest Piece", 18, "chicken", 350, [
    { key: "chaat_masala", quantity: 3, unit: G },
  ]),
  chickenBbq("chicken_tikka_leg", "Chicken Tikka Leg Piece", 18, "chicken", 320, [
    { key: "chaat_masala", quantity: 3, unit: G },
  ]),
  chickenBbq("afghani_tikka_chest", "Afghani Tikka Chest Piece", 18, "chicken", 350, [
    { key: "cream", quantity: 35, unit: ML },
    { key: "white_pepper", quantity: 2, unit: G },
  ]),
  chickenBbq("afghani_tikka_leg", "Afghani Tikka Leg Piece", 18, "chicken", 320, [
    { key: "cream", quantity: 30, unit: ML },
    { key: "white_pepper", quantity: 2, unit: G },
  ]),
  r("grill_fish", "Special Grill Fish", "BBQ", KG, 1, 20, [
    { key: "fish", quantity: 1, unit: KG },
    { key: "lemon", quantity: 2, unit: PCS },
    { key: "garlic", quantity: 20, unit: G },
    { key: "oil", quantity: 40, unit: ML },
    { key: "salt", quantity: 10, unit: G },
    { key: "black_pepper", quantity: 5, unit: G },
    { key: "chaat_masala", quantity: 4, unit: G },
  ]),

  // —— Pakistani Special ——
  r("mutton_namkeen_gosht", "Mutton Namkeen Gosht Special", "Pakistani Special", KG, 1, 35, [
    { key: "mutton", quantity: 1, unit: KG },
    { key: "garlic", quantity: 80, unit: G },
    { key: "ginger", quantity: 30, unit: G },
    { key: "green_chilli", quantity: 40, unit: G },
    { key: "salt", quantity: 15, unit: G },
    { key: "black_pepper", quantity: 6, unit: G },
  ]),
  r("beef_namkeen_gosht", "Beef Namkeen Gosht", "Pakistani Special", KG, 1, 35, [
    { key: "beef", quantity: 1, unit: KG },
    { key: "garlic", quantity: 80, unit: G },
    { key: "ginger", quantity: 30, unit: G },
    { key: "green_chilli", quantity: 40, unit: G },
    { key: "salt", quantity: 15, unit: G },
    { key: "black_pepper", quantity: 6, unit: G },
  ]),
  r("beef_namkeen_platter", "Beef Namkeen Platter", "Pakistani Special", PCS, 1, 25, [
    { key: "beef", quantity: 0.5, unit: KG },
    { key: "garlic", quantity: 40, unit: G },
    { key: "salt", quantity: 8, unit: G },
    { key: "oil", quantity: 30, unit: ML },
  ]),

  // —— Chicken Karahi ——
  chickenKarahi("sangat_chicken_karahi", "Quetta Sangat Special Chicken Karahi", 25, [
    { key: "butter", quantity: 30, unit: G },
    { key: "black_pepper", quantity: 6, unit: G },
  ]),
  chickenKarahi("desi_murgha_karahi", "Special Desi Murgha Karahi", 30, [
    { key: "chilli_flakes", quantity: 12, unit: G },
    { key: "garam_masala", quantity: 6, unit: G },
  ]),
  chickenKarahi("chicken_lahori_karahi", "Chicken Lahori Karahi (Red Chilli)", 25, [
    { key: "chilli_flakes", quantity: 18, unit: G },
  ]),
  chickenKarahi("chicken_black_pepper_karahi", "Chicken Karahi (Black Pepper)", 25, [
    { key: "black_pepper", quantity: 18, unit: G },
  ]),
  chickenKarahi("chicken_achari_karahi", "Chicken Achari Karahi", 25, [
    { key: "vinegar", quantity: 20, unit: ML },
    { key: "chilli_flakes", quantity: 10, unit: G },
    { key: "cumin", quantity: 6, unit: G },
  ]),

  // —— Beef Karahi ——
  beefKarahi("sangat_beef_karahi", "Quetta Sangat Special Beef Karahi", 30, [
    { key: "butter", quantity: 30, unit: G },
  ]),
  beefKarahi("beef_lahori_karahi", "Beef Lahori Karahi (Red Chilli)", 30, [
    { key: "chilli_flakes", quantity: 18, unit: G },
  ]),
  beefKarahi("beef_black_pepper_karahi", "Beef Karahi (Black Pepper)", 30, [
    { key: "black_pepper", quantity: 18, unit: G },
  ]),
  beefKarahi("beef_afghani_karahi", "Beef Afghani Karahi (White)", 30, [
    { key: "yogurt", quantity: 200, unit: G },
    { key: "cream", quantity: 100, unit: ML },
    { key: "white_pepper", quantity: 6, unit: G },
  ]),

  // —— Mutton Karahi ——
  muttonKarahi("sangat_mutton_karahi", "Quetta Sangat Special Mutton Karahi", 35, [
    { key: "butter", quantity: 35, unit: G },
  ]),
  muttonKarahi("mutton_lahori_karahi", "Mutton Lahori Karahi (Red Chilli)", 35, [
    { key: "chilli_flakes", quantity: 16, unit: G },
  ]),
  muttonKarahi("mutton_black_pepper_karahi", "Mutton Karahi (Black Pepper)", 35, [
    { key: "black_pepper", quantity: 16, unit: G },
  ]),
  muttonKarahi("mutton_afghani_karahi", "Mutton Afghani Karahi (White)", 35, [
    { key: "yogurt", quantity: 200, unit: G },
    { key: "cream", quantity: 100, unit: ML },
    { key: "white_pepper", quantity: 6, unit: G },
  ]),
  muttonKarahi("mutton_peshawari_karahi", "Mutton Peshawari Karahi (Shinwari)", 35, [
    { key: "black_pepper", quantity: 12, unit: G },
  ]),

  // —— Mutton Handi ——
  muttonHandi("special_mutton_handi", "Special Mutton Handi (With Bone)", 35, [
    { key: "cream", quantity: 80, unit: ML },
    { key: "kasoori_methi", quantity: 3, unit: G },
  ]),
  muttonHandi("mutton_handi", "Mutton Handi (With Bone)", 35, [
    { key: "cream", quantity: 60, unit: ML },
  ]),
  r("mutton_hari_mirch_handi", "Mutton Hari Mirch Handi (With Bone)", "Mutton Handi", KG, 1, 35, [
    { key: "mutton", quantity: 1, unit: KG },
    { key: "oil", quantity: 120, unit: ML },
    { key: "yogurt", quantity: 280, unit: G },
    { key: "ginger_garlic", quantity: 45, unit: G },
    { key: "onion", quantity: 180, unit: G },
    { key: "tomato", quantity: 100, unit: G },
    { key: "green_chilli", quantity: 150, unit: G },
    { key: "salt", quantity: 12, unit: G },
  ]),
  muttonHandi("mutton_afghani_handi", "Mutton Afghani Handi (White / With Bone)", 35, [
    { key: "cream", quantity: 120, unit: ML },
    { key: "white_pepper", quantity: 5, unit: G },
  ]),

  // —— Chicken Handi ——
  chickenHandi("sangat_chicken_handi", "Quetta Sangat Special Chicken Handi", 25, [
    { key: "cream", quantity: 100, unit: ML },
    { key: "kasoori_methi", quantity: 3, unit: G },
  ]),
  chickenHandi("chicken_handi", "Chicken Handi", 25, [
    { key: "cream", quantity: 60, unit: ML },
  ]),
  r("chicken_hari_mirch_handi", "Chicken Hari Mirch Handi", "Chicken Handi", KG, 1, 25, [
    { key: "chicken_boneless", quantity: 1, unit: KG },
    { key: "oil", quantity: 100, unit: ML },
    { key: "butter", quantity: 40, unit: G },
    { key: "yogurt", quantity: 250, unit: G },
    { key: "ginger_garlic", quantity: 40, unit: G },
    { key: "onion", quantity: 150, unit: G },
    { key: "tomato", quantity: 120, unit: G },
    { key: "green_chilli", quantity: 140, unit: G },
    { key: "salt", quantity: 10, unit: G },
  ]),
  chickenHandi("chicken_achari_handi", "Chicken Achari Handi", 25, [
    { key: "vinegar", quantity: 15, unit: ML },
    { key: "cumin", quantity: 5, unit: G },
  ]),
  r("chicken_jalfrezi", "Chicken Jalfrezi", "Chicken Handi", PCS, 1, 20, [
    { key: "chicken_boneless", quantity: 350, unit: G },
    { key: "capsicum", quantity: 80, unit: G },
    { key: "onion", quantity: 80, unit: G },
    { key: "tomato", quantity: 80, unit: G },
    { key: "oil", quantity: 40, unit: ML },
    { key: "ginger_garlic", quantity: 20, unit: G },
    { key: "salt", quantity: 5, unit: G },
  ]),
  r("chicken_chatkhara", "Chicken Chatkhara", "Chicken Handi", PCS, 1, 20, [
    { key: "chicken_boneless", quantity: 350, unit: G },
    { key: "onion", quantity: 80, unit: G },
    { key: "tomato", quantity: 100, unit: G },
    { key: "green_chilli", quantity: 40, unit: G },
    { key: "oil", quantity: 40, unit: ML },
    { key: "chaat_masala", quantity: 4, unit: G },
    { key: "salt", quantity: 5, unit: G },
  ]),
  r("chicken_ginger", "Chicken Ginger", "Chicken Handi", PCS, 1, 20, [
    { key: "chicken_boneless", quantity: 350, unit: G },
    { key: "ginger", quantity: 60, unit: G },
    { key: "onion", quantity: 60, unit: G },
    { key: "oil", quantity: 40, unit: ML },
    { key: "soy", quantity: 15, unit: ML },
    { key: "salt", quantity: 5, unit: G },
  ]),

  // —— Chinese Rice ——
  friedRice("sangat_special_rice", "Quetta Sangat Special Rice", 15, [
    { key: "chicken_boneless", quantity: 80, unit: G },
    { key: "egg", quantity: 1, unit: PCS },
    { key: "carrot", quantity: 30, unit: G },
    { key: "cabbage", quantity: 30, unit: G },
  ]),
  friedRice("chicken_fried_rice", "Chicken Fried Rice", 15, [
    { key: "chicken_boneless", quantity: 100, unit: G },
    { key: "egg", quantity: 1, unit: PCS },
  ]),
  friedRice("chicken_masala_rice", "Chicken Masala Rice", 15, [
    { key: "chicken_boneless", quantity: 100, unit: G },
    { key: "chilli_flakes", quantity: 4, unit: G },
    { key: "ketchup", quantity: 20, unit: ML },
  ]),
  friedRice("egg_fried_rice", "Egg Fried Rice", 12, [
    { key: "egg", quantity: 2, unit: PCS },
  ]),
  friedRice("vegetable_rice", "Vegetable Rice", 12, [
    { key: "carrot", quantity: 40, unit: G },
    { key: "cabbage", quantity: 40, unit: G },
    { key: "capsicum", quantity: 30, unit: G },
  ]),

  // —— Chinese Combo ——
  r("chicken_garlic_fried_rice", "Chicken Garlic + Fried Rice", "Chinese Combo", PCS, 1, 18, [
    { key: "chicken_boneless", quantity: 250, unit: G },
    { key: "garlic", quantity: 25, unit: G },
    { key: "oil", quantity: 50, unit: ML },
    { key: "soy", quantity: 25, unit: ML },
    { key: "rice", quantity: 300, unit: G },
    { key: "egg", quantity: 1, unit: PCS },
    { key: "salt", quantity: 4, unit: G },
  ]),
  r("chicken_black_pepper_fried_rice", "Chicken Black Pepper + Fried Rice", "Chinese Combo", PCS, 1, 18, [
    { key: "chicken_boneless", quantity: 250, unit: G },
    { key: "black_pepper", quantity: 8, unit: G },
    { key: "oil", quantity: 50, unit: ML },
    { key: "soy", quantity: 25, unit: ML },
    { key: "rice", quantity: 300, unit: G },
    { key: "egg", quantity: 1, unit: PCS },
    { key: "salt", quantity: 4, unit: G },
  ]),

  // —— Salad ——
  r("green_salad", "Green Salad", "Salad", PCS, 1, 5, [
    { key: "lettuce", quantity: 80, unit: G },
    { key: "cucumber", quantity: 60, unit: G },
    { key: "tomato", quantity: 60, unit: G },
    { key: "lemon", quantity: 0.5, unit: PCS },
    { key: "salt", quantity: 2, unit: G },
  ]),
  r("kachumar_salad", "Kachumar Salad", "Salad", PCS, 1, 5, [
    { key: "onion", quantity: 60, unit: G },
    { key: "tomato", quantity: 60, unit: G },
    { key: "cucumber", quantity: 60, unit: G },
    { key: "green_chilli", quantity: 10, unit: G },
    { key: "lemon", quantity: 0.5, unit: PCS },
    { key: "chaat_masala", quantity: 2, unit: G },
    { key: "salt", quantity: 2, unit: G },
  ]),

  // —— Beverages (counter) ——
  pcsDrink("regular_cold_drink", "Regular Cold Drink", "cold_drink_regular"),
  pcsDrink("can_pack", "Can Pack", "cold_drink_can"),
  pcsDrink("can_pack_sf", "Can Pack (Sugar Free)", "cold_drink_can_sf"),
  pcsDrink("drink_1l", "1 Litre Drink", "cold_drink_1l"),
  pcsDrink("drink_1_5l", "1.5 Litre Drink", "cold_drink_1_5l"),
  pcsDrink("drink_2l", "2 Litre Drink", "cold_drink_2l"),
  pcsDrink("water_small", "Mineral Water (Small)", "mineral_water_small"),
  pcsDrink("water_large", "Mineral Water (Large)", "mineral_water_large"),
  r("green_tea_cup", "Green Tea", "Beverages", PCS, 1, 4, [
    { key: "green_tea", quantity: 2, unit: G },
  ]),
];
