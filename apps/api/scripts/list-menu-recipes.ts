import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const menu = await p.menuItem.findMany({
    where: { active: true },
    select: {
      name: true,
      category: true,
      recipeId: true,
      kind: true,
      kitchenStation: true,
      recipe: { select: { name: true, prepMinutes: true } },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const recipes = await p.recipe.findMany({
    where: { active: true },
    select: { name: true, category: true, prepMinutes: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  console.log("MENU", menu.length, "RECIPES", recipes.length);
  console.log("NO_RECIPE", menu.filter((m) => !m.recipeId).length);
  for (const m of menu) {
    console.log(
      [m.kind, m.category, m.name, m.kitchenStation, m.recipe?.name ?? "NO", m.recipe?.prepMinutes ?? "-"].join(
        " | "
      )
    );
  }
  console.log("---RECIPES---");
  for (const r of recipes) {
    console.log([r.category, r.name, r.prepMinutes].join(" | "));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
