import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { migrateDeploy } from "./schema-migrate";

/** Keep Waiter role able to send kitchen / KOT (seed + live DB). */
const WAITER_EXTRA_PERMS = ["order.create", "order.addItems", "print.kot", "kitchen.view"] as const;

/** Supervisor must update the kitchen board (full queue via kitchen.update). */
const SUPERVISOR_EXTRA_PERMS = ["kitchen.view", "kitchen.update"] as const;

/**
 * On API boot, apply pending Prisma migrations (with P3009/P3018 recovery).
 * Prevents "column does not exist" 500 storms after restore/upgrade drift.
 */
@Injectable()
export class SchemaHealService implements OnModuleInit {
  private readonly log = new Logger("SchemaHeal");

  async onModuleInit() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.log.warn("DATABASE_URL missing — skip schema heal");
      return;
    }
    // Start script already ran migrate on Render; a second deploy hits P1002 advisory-lock timeout.
    if (process.env.HOTEL_SKIP_SCHEMA_HEAL === "1" || process.env.RENDER === "true") {
      this.log.warn(
        process.env.HOTEL_SKIP_SCHEMA_HEAL === "1"
          ? "HOTEL_SKIP_SCHEMA_HEAL=1 — skip schema heal"
          : "RENDER=true — skip duplicate migrate (start script owns it)"
      );
      try {
        await this.ensureKitchenRolePerms();
      } catch (e) {
        this.log.warn(`Kitchen role perm sync skipped: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }
    const apiRoot = join(__dirname, "../..");
    try {
      this.log.log("Checking database schema (migrate deploy)…");
      await migrateDeploy({
        apiRoot,
        databaseUrl: url,
        log: (m) => this.log.warn(m),
      });
      this.log.log("Database schema OK");
      await this.ensureKitchenRolePerms();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Another migrate/seed still holds the lock — app can still serve; next boot will retry.
      if (/P1002|advisory lock/i.test(msg)) {
        this.log.warn(`Schema heal skipped (DB lock busy): ${msg}`);
        return;
      }
      this.log.error(
        `Schema heal failed — API may error until migrations are applied: ${msg}`
      );
    }
  }

  private async ensureKitchenRolePerms() {
    const prisma = new PrismaClient();
    try {
      await this.ensureRolePerms(prisma, "WAITER", WAITER_EXTRA_PERMS, "Waiter");
      await this.ensureRolePerms(prisma, "SUPERVISOR", SUPERVISOR_EXTRA_PERMS, "Supervisor");
    } catch (e) {
      this.log.warn(`Kitchen role perm sync skipped: ${e instanceof Error ? e.message : e}`);
    } finally {
      await prisma.$disconnect();
    }
  }

  private async ensureRolePerms(
    prisma: PrismaClient,
    roleCode: string,
    codes: readonly string[],
    label: string
  ) {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) return;
    const perms = await prisma.permission.findMany({
      where: { code: { in: [...codes] } },
    });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        create: { roleId: role.id, permissionId: p.id },
        update: {},
      });
    }
    if (perms.length) this.log.log(`${label} kitchen perms ensured (${perms.map((p) => p.code).join(", ")})`);
  }
}
