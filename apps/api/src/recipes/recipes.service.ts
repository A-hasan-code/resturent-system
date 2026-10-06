import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UnitType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber, unitsCompatible } from "../common/units";
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
      let costPerBase = 0;
      let totalForBase = 0;
      try {
        const c = await this.costing.recipeUnitCost(r.id);
        costPerBase = c.costPerBase;
        totalForBase = c.totalForBase;
      } catch {
        /* inactive ingredient / unit mismatch — still list recipe */
      }
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
          storeUnit: i.storeItem.unit,
          ratePerUnit: toNumber(i.storeItem.ratePerUnit),
          storeActive: i.storeItem.active,
        })),
      });
    }
    return out;
  }

  async create(dto: CreateRecipeDto) {
    const catName = dto.category?.trim() || "General";
    await this.ensureCategory(catName);
    const name = dto.name.trim();
    await this.assertNameFree(name);
    const ingredients = await this.validateIngredients(dto.ingredients);

    try {
      return await this.prisma.recipe.create({
        data: {
          name,
          category: catName,
          baseUnit: dto.baseUnit ?? "KG",
          baseQty: dto.baseQty ?? 1,
          ingredients: { create: ingredients },
        },
        include: { ingredients: true },
      });
    } catch (e) {
      this.rethrowUniqueName(e);
      throw e;
    }
  }

  async update(id: string, dto: UpdateRecipeDto) {
    const existing = await this.prisma.recipe.findFirst({
      where: { id, active: true },
    });
    if (!existing) throw new NotFoundException("Recipe not found");

    const catName =
      dto.category != null ? dto.category.trim() || "General" : undefined;
    if (catName) await this.ensureCategory(catName);

    const name = dto.name != null ? dto.name.trim() : undefined;
    if (name) await this.assertNameFree(name, id);

    const ingredients =
      dto.ingredients?.length != null && dto.ingredients.length > 0
        ? await this.validateIngredients(dto.ingredients)
        : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (ingredients) {
          await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
          await tx.recipeIngredient.createMany({
            data: ingredients.map((i) => ({
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
            ...(name != null ? { name } : {}),
            ...(catName != null ? { category: catName } : {}),
            ...(dto.baseUnit != null ? { baseUnit: dto.baseUnit } : {}),
            ...(dto.baseQty != null ? { baseQty: dto.baseQty } : {}),
          },
          include: { ingredients: true },
        });
      });
    } catch (e) {
      this.rethrowUniqueName(e);
      throw e;
    }
  }

  /** Soft-delete and free the unique name so the same dish can be recreated. */
  async remove(id: string) {
    const existing = await this.prisma.recipe.findFirst({ where: { id, active: true } });
    if (!existing) throw new NotFoundException("Recipe not found");

    const freed = `${existing.name} · removed ${id.slice(-6)}`;
    return this.prisma.recipe.update({
      where: { id },
      data: { active: false, name: freed },
    });
  }

  private async assertNameFree(name: string, excludeId?: string) {
    const clash = await this.prisma.recipe.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        active: true,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new BadRequestException(`Recipe "${clash.name}" already exists`);
    }
  }

  private async validateIngredients(
    rows: { storeItemId: string; quantity: number; unit: UnitType }[]
  ) {
    if (!rows?.length) throw new BadRequestException("Add at least 1 ingredient");

    const ids = rows.map((r) => r.storeItemId);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new BadRequestException("Duplicate store item in recipe — merge quantities instead");
    }

    const items = await this.prisma.storeItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, unit: true, active: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    const cleaned: { storeItemId: string; quantity: number; unit: UnitType }[] = [];
    for (const r of rows) {
      const item = byId.get(r.storeItemId);
      if (!item) throw new BadRequestException("Store item not found for ingredient");
      if (!item.active) {
        throw new BadRequestException(`Store item "${item.name}" is inactive — remove or replace it`);
      }
      if (!unitsCompatible(r.unit, item.unit)) {
        throw new BadRequestException(
          `"${item.name}" is stocked in ${item.unit} — recipe qty must use the same unit family (not ${r.unit})`
        );
      }
      if (!(r.quantity > 0)) {
        throw new BadRequestException(`Quantity required for "${item.name}"`);
      }
      cleaned.push({
        storeItemId: r.storeItemId,
        quantity: r.quantity,
        unit: r.unit,
      });
    }
    return cleaned;
  }

  private rethrowUniqueName(e: unknown): void {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BadRequestException("Recipe name already exists");
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
