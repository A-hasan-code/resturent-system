import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber } from "../common/units";
import {
  CreateRecipeCategoryDto,
  CreateRecipeDto,
  UpdateRecipeDto,
} from "./dto";

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService
  ) {}

  listCategories() {
    return this.prisma.recipeCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  createCategory(dto: CreateRecipeCategoryDto) {
    return this.prisma.recipeCategory.create({
      data: {
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async list() {
    const recipes = await this.prisma.recipe.findMany({
      where: { active: true },
      include: {
        ingredients: {
          include: { storeItem: { include: { category: true } } },
        },
      },
      orderBy: { name: "asc" },
    });

    const out = [];
    for (const r of recipes) {
      const { costPerBase, totalForBase } = await this.costing.recipeUnitCost(
        r.id
      );
      out.push({
        id: r.id,
        name: r.name,
        category: r.category,
        baseUnit: r.baseUnit,
        baseQty: toNumber(r.baseQty),
        costPerBase,
        totalForBase,
        ingredients: r.ingredients.map((i) => ({
          id: i.id,
          storeItemId: i.storeItemId,
          name: i.storeItem.name,
          category: i.storeItem.category.name,
          quantity: toNumber(i.quantity),
          unit: i.unit,
          ratePerUnit: toNumber(i.storeItem.ratePerUnit),
        })),
      });
    }
    return out;
  }

  async create(dto: CreateRecipeDto) {
    const catName = dto.category?.trim() || "General";
    await this.ensureCategory(catName);

    return this.prisma.recipe.create({
      data: {
        name: dto.name,
        category: catName,
        baseUnit: dto.baseUnit ?? "KG",
        baseQty: dto.baseQty ?? 1,
        ingredients: { create: dto.ingredients },
      },
      include: { ingredients: true },
    });
  }

  async update(id: string, dto: UpdateRecipeDto) {
    const existing = await this.prisma.recipe.findFirst({
      where: { id, active: true },
    });
    if (!existing) throw new NotFoundException("Recipe not found");

    const catName =
      dto.category != null ? dto.category.trim() || "General" : undefined;
    if (catName) await this.ensureCategory(catName);

    return this.prisma.$transaction(async (tx) => {
      if (dto.ingredients?.length) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
        await tx.recipeIngredient.createMany({
          data: dto.ingredients.map((i) => ({
            recipeId: id,
            storeItemId: i.storeItemId,
            quantity: i.quantity,
            unit: i.unit,
          })),
        });
      }

      return tx.recipe.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(catName != null ? { category: catName } : {}),
          ...(dto.baseUnit != null ? { baseUnit: dto.baseUnit } : {}),
          ...(dto.baseQty != null ? { baseQty: dto.baseQty } : {}),
        },
        include: { ingredients: true },
      });
    });
  }

  async remove(id: string) {
    try {
      return await this.prisma.recipe.update({
        where: { id },
        data: { active: false },
      });
    } catch {
      throw new NotFoundException("Recipe not found");
    }
  }

  private async ensureCategory(name: string) {
    const existing = await this.prisma.recipeCategory.findUnique({
      where: { name },
    });
    if (!existing) {
      await this.prisma.recipeCategory.create({ data: { name } });
    }
  }
}
