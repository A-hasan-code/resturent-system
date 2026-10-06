import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { join } from "path";
import { migrateDeploy } from "./schema-migrate";

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
    if (process.env.HOTEL_SKIP_SCHEMA_HEAL === "1") {
      this.log.warn("HOTEL_SKIP_SCHEMA_HEAL=1 — skip schema heal");
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
    } catch (e) {
      // Do not crash the process — installer / Repair-Migrations can still fix;
      // but log loudly so support sees it.
      this.log.error(
        `Schema heal failed — API may error until migrations are applied: ${
          e instanceof Error ? e.message : e
        }`
      );
    }
  }
}
