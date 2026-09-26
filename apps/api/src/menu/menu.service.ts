import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber } from "../common/units";
import { CreateMenuItemDto, UpdateMenuItemDto } from "./dto";

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService
  ) {}

  async list() {
    const items = await this.prisma.menuItem.findMany({
      where: { active: true },
      include: { recipe: true },
      orderBy: { name: "asc" },
    });

    const out = [];
    for (const m of items) {
      let cost = 0;
      if (m.recipeId) {
        const c = await this.costing.recipeUnitCost(m.recipeId);
        cost = c.costPerBase;
      }
      const sell = toNumber(m.sellingPrice);
      out.push({
        id: m.id,
        name: m.name,
        category: m.category,
        sellUnit: m.sellUnit,
        sellingPrice: sell,
        costPerUnit: cost,
        profitPerUnit: sell - cost,
        recipeId: m.recipeId,
      });
    }
    return out;
  }

  create(dto: CreateMenuItemDto) {
    return this.prisma.menuItem.create({ data: dto });
  }

  async update(id: string, dto: UpdateMenuItemDto) {
    try {
      return await this.prisma.menuItem.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.sellUnit != null ? { sellUnit: dto.sellUnit } : {}),
          ...(dto.sellingPrice != null
            ? { sellingPrice: dto.sellingPrice }
            : {}),
          ...(dto.recipeId !== undefined
            ? { recipeId: dto.recipeId || null }
            : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
      });
    } catch {
      throw new NotFoundException("Menu item not found");
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.menuItem.update({
        where: { id },
        data: { active: false },
      });
    } catch {
      throw new NotFoundException("Menu item not found");
    }
  }
}
