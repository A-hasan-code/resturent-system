import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { dataDir } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { migrateDeploy } from "./schema-migrate";

export type BackupFile = {
  file: string;
  size: number;
  createdAt: string;
  auto: boolean;
  kind: "daily" | "monthly" | "manual" | "safety";
};

type CreateKind = "manual" | "pre-restore" | "pre-upgrade" | "auto" | "monthly";

/** Reject tiny / empty dumps before touching live. */
const MIN_DUMP_BYTES = 8_192;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Keep this many daily (-auto) dumps; older ones are deleted. */
const KEEP_DAILY = 30;
const TEMP_DB = "hotel_db_restore";
const PREV_DB = "hotel_db_prev";

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Backup");
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Daily auto backup shortly after boot, then every hour (creates at most one per calendar day).
    setTimeout(() => void this.ensureDailyBackup(), 45_000);
    this.timer = setInterval(() => void this.ensureDailyBackup(), 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dir() {
    if (process.env.BACKUP_DIR) {
      if (!existsSync(process.env.BACKUP_DIR)) mkdirSync(process.env.BACKUP_DIR, { recursive: true });
      return process.env.BACKUP_DIR;
    }
    return dataDir("backups");
  }

  list(): BackupFile[] {
    const dir = this.dir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".dump"))
      .map((f) => {
        const st = statSync(join(dir, f));
        return {
          file: f,
          size: st.size,
          createdAt: st.mtime.toISOString(),
          auto: f.includes("-auto") || f.includes("-monthly"),
          kind: kindOf(f),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(kind: CreateKind = "manual"): Promise<BackupFile> {
    if (this.running) throw new BadRequestException("Backup already running");
    this.running = true;
    try {
      return await this.dumpLive(kind);
    } finally {
      this.running = false;
    }
  }

  /**
   * Safe restore:
   * 1) Mandatory safety dump of live DB
   * 2) Restore + migrate into a TEMP database (live untouched)
   * 3) Swap temp <-> live only after verify
   * 4) Any failure before swap leaves live data as it was
   * 5) If swap mid-fails, try rename previous live back
   */
  async restore(file: string) {
    const safe = basename(file);
    const full = join(this.dir(), safe);
    if (!safe.endsWith(".dump") || !existsSync(full)) {
      throw new BadRequestException("Backup file not found");
    }
    const dumpSize = statSync(full).size;
    if (dumpSize < MIN_DUMP_BYTES) {
      throw new BadRequestException(
        `Backup file looks empty or corrupt (${dumpSize} bytes). Live database was not changed.`
      );
    }
    if (this.running) throw new BadRequestException("Backup/restore already running");
    this.running = true;

    const liveName = liveDbName();
    const liveUrl = dbUrl();
    const tempUrl = urlWithDatabase(liveUrl, TEMP_DB);
    let swapped = false;

    try {
      const liveBaseline = await this.countCoreRows(liveUrl).catch(() => ({
        users: 0,
        menuItems: 0,
        orders: 0,
      }));

      // 1) Mandatory safety copy — refuse restore if this fails
      this.log.log("Creating mandatory pre-restore safety backup…");
      await this.dumpLive("pre-restore");

      // 2) Build temp DB from dump (never touch live contents yet)
      this.log.log(`Preparing temp database ${TEMP_DB}`);
      await this.dropDatabase(TEMP_DB);
      await this.createDatabase(TEMP_DB);
      await this.pgRestore(full, tempUrl);
      await this.runMigrate(tempUrl);
      await this.verifyDatabase(tempUrl, liveBaseline);

      // 3) Atomic-ish swap: disconnect API → rename DBs → reconnect
      this.log.warn(`Swapping ${TEMP_DB} → ${liveName} (live was untouched until now)`);
      await this.prisma.$disconnect().catch(() => undefined);
      await this.terminateDbSessions(liveName);
      await this.terminateDbSessions(TEMP_DB);
      await this.dropDatabase(PREV_DB);
      await this.renameDatabase(liveName, PREV_DB);
      swapped = true;
      try {
        await this.renameDatabase(TEMP_DB, liveName);
      } catch (e) {
        // Put live back if temp rename failed
        this.log.error(`Swap failed renaming temp → live: ${e}`);
        await this.renameDatabase(PREV_DB, liveName).catch((err) =>
          this.log.error(`CRITICAL: could not rename ${PREV_DB} back to ${liveName}: ${err}`)
        );
        swapped = false;
        throw e;
      }

      await this.prisma.$connect();
      // Schema should already match; deploy is a no-op safety net on live name
      try {
        await this.runMigrate(liveUrl);
      } catch (e) {
        this.log.warn(`Post-swap migrate on live: ${e instanceof Error ? e.message : e}`);
      }

      await this.dropDatabase(PREV_DB);
      this.log.warn(`Database restored safely from ${safe}`);
      return { ok: true, restored: safe, mode: "safe-swap" as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`Restore failed (live kept safe where possible): ${msg}`);

      // Cleanup temp if we never swapped
      if (!swapped) {
        await this.dropDatabase(TEMP_DB).catch(() => undefined);
        try {
          await this.prisma.$connect();
        } catch {
          /* ignore */
        }
      }

      throw new BadRequestException(
        msg.includes("Safety backup")
          ? msg
          : `Restore failed — your current data was kept. ${msg}`.slice(0, 800)
      );
    } finally {
      this.running = false;
    }
  }

  /** One automatic dump per local calendar day; prune old daily files. */
  async ensureDailyBackup() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const hasToday = this.list().some((b) => b.kind === "daily" && b.file.includes(`hotel-${today}`));
      if (!hasToday) {
        await this.create("auto");
        this.log.log("Daily auto backup created");
      }
      this.pruneDaily();
    } catch (e) {
      this.log.warn(`Daily backup failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async dumpLive(kind: CreateKind): Promise<BackupFile> {
    const dir = this.dir();
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const name = `hotel-${stamp}-${kind}.dump`;
    const file = join(dir, name);
    try {
      await run(pgBin("pg_dump"), ["--format=custom", "--no-owner", `--file=${file}`, `--dbname=${dbUrl()}`], {
        allowWarn: false,
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (kind === "pre-restore") {
        throw new BadRequestException(
          `Safety backup failed — restore aborted so live data stays safe. ${detail}`
        );
      }
      throw e instanceof BadRequestException ? e : new BadRequestException(detail);
    }
    this.log.log(`Backup saved: ${file}`);
    const listed = this.list().find((b) => b.file === name);
    if (listed) return listed;
    const st = statSync(file);
    return {
      file: name,
      size: st.size,
      createdAt: st.mtime.toISOString(),
      auto: kind === "auto" || kind === "monthly",
      kind: kindOf(name),
    };
  }

  private async pgRestore(dumpPath: string, targetUrl: string) {
    // Empty/new DB: --clean is fine; treat exit 1 (warnings) as OK unless fatal text.
    await run(
      pgBin("pg_restore"),
      ["--clean", "--if-exists", "--no-owner", `--dbname=${targetUrl.split("?")[0]}`, dumpPath],
      { allowWarn: true }
    );
  }

  private async runMigrate(databaseUrl: string) {
    try {
      await migrateDeploy({
        apiRoot: apiRoot(),
        databaseUrl,
        log: (m) => this.log.warn(m),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(msg);
    }
  }

  private async countCoreRows(databaseUrl: string): Promise<{
    users: number;
    menuItems: number;
    orders: number;
  }> {
    const sql = `SELECT
      (SELECT COUNT(*)::int FROM "User") AS users,
      (SELECT COUNT(*)::int FROM "MenuItem") AS "menuItems",
      (SELECT COUNT(*)::int FROM "Order") AS orders;`;
    const out = await runCapture(
      pgBin("psql"),
      [databaseUrl.split("?")[0], "-v", "ON_ERROR_STOP=1", "-tAc", sql],
      { env: { ...process.env, PGPASSWORD: dbPassword() } }
    );
    // psql -tAc with multiple columns → "u|m|o"
    const parts = String(out).trim().split("|").map((p) => Number(p.trim()));
    return {
      users: Number.isFinite(parts[0]) ? parts[0] : 0,
      menuItems: Number.isFinite(parts[1]) ? parts[1] : 0,
      orders: Number.isFinite(parts[2]) ? parts[2] : 0,
    };
  }

  private async verifyDatabase(
    databaseUrl: string,
    live: { users: number; menuItems: number; orders: number }
  ) {
    // Tables must exist
    const tablesOut = await runCapture(
      pgBin("psql"),
      [
        databaseUrl.split("?")[0],
        "-v",
        "ON_ERROR_STOP=1",
        "-tAc",
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('User','MenuItem','Order');`,
      ],
      { env: { ...process.env, PGPASSWORD: dbPassword() } }
    );
    const tableCount = Number(String(tablesOut).trim());
    if (!Number.isFinite(tableCount) || tableCount < 3) {
      throw new BadRequestException(
        `Restored backup looks incomplete (core tables missing). Live database was not changed.`
      );
    }

    const restored = await this.countCoreRows(databaseUrl);

    // Empty / wiped dumps must never replace a live hotel
    if (restored.users < 1) {
      throw new BadRequestException(
        `Restored backup has no users (unusable). Live database was not changed.`
      );
    }
    if (live.menuItems > 0 && restored.menuItems === 0) {
      throw new BadRequestException(
        `Restored backup has no menu items, but the live hotel has ${live.menuItems}. Restore blocked to protect your menu. Live database was not changed.`
      );
    }
    if (live.users > 0 && restored.users === 0) {
      throw new BadRequestException(
        `Restored backup would wipe all users. Live database was not changed.`
      );
    }
    // Live had real activity; restore is essentially empty catalog
    if (live.orders > 10 && restored.orders === 0 && restored.menuItems === 0) {
      throw new BadRequestException(
        `Restored backup looks empty compared to the live hotel. Live database was not changed.`
      );
    }

    this.log.log(
      `Restore verify OK: users=${restored.users} menu=${restored.menuItems} orders=${restored.orders}`
    );
  }

  private async createDatabase(name: string) {
    await sqlOnPostgres(`CREATE DATABASE "${name}" OWNER CURRENT_USER;`);
  }

  private async dropDatabase(name: string) {
    await this.terminateDbSessions(name);
    await sqlOnPostgres(`DROP DATABASE IF EXISTS "${name}";`);
  }

  private async renameDatabase(from: string, to: string) {
    await this.terminateDbSessions(from);
    await sqlOnPostgres(`ALTER DATABASE "${from}" RENAME TO "${to}";`);
  }

  private async terminateDbSessions(dbName: string) {
    await sqlOnPostgres(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName.replace(/'/g, "''")}' AND pid <> pg_backend_pid();`
    ).catch(() => undefined);
  }

  private pruneDaily() {
    const daily = this.list().filter((b) => b.kind === "daily");
    for (const b of daily.slice(KEEP_DAILY)) {
      try {
        unlinkSync(join(this.dir(), b.file));
      } catch {
        /* ignore */
      }
    }
    const cutoff = Date.now() - 90 * DAY_MS;
    for (const b of this.list()) {
      if (b.kind !== "daily" && b.kind !== "safety") continue;
      if (new Date(b.createdAt).getTime() >= cutoff) continue;
      try {
        unlinkSync(join(this.dir(), b.file));
      } catch {
        /* ignore */
      }
    }
  }
}

function kindOf(file: string): BackupFile["kind"] {
  if (file.includes("-monthly")) return "monthly";
  if (file.includes("-auto")) return "daily";
  if (file.includes("-pre-restore") || file.includes("-pre-upgrade")) return "safety";
  return "manual";
}

function apiRoot() {
  // dist/system → apps/api (or installed app/api)
  return join(__dirname, "../..");
}

function pgBin(name: string) {
  const dir = process.env.PG_BIN;
  if (dir) {
    const exe = join(dir, process.platform === "win32" ? `${name}.exe` : name);
    if (!existsSync(exe)) {
      throw new BadRequestException(`${name} not found at ${exe} — check PG_BIN in hotel.env`);
    }
    return exe;
  }
  return process.platform === "win32" ? `${name}.exe` : name;
}

function dbUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new BadRequestException("DATABASE_URL not set");
  return url;
}

function liveDbName() {
  try {
    const u = new URL(dbUrl().split("?")[0]);
    return decodeURIComponent(u.pathname.replace(/^\//, "")) || "hotel_db";
  } catch {
    return "hotel_db";
  }
}

function dbPassword() {
  try {
    return decodeURIComponent(new URL(dbUrl().split("?")[0]).password || "");
  } catch {
    return "";
  }
}

function urlWithDatabase(url: string, dbName: string) {
  const [base, query] = url.split("?");
  const replaced = base.replace(/\/[^/?]+$/, `/${dbName}`);
  return query ? `${replaced}?${query}` : replaced;
}

function postgresAdminUrl() {
  return urlWithDatabase(dbUrl().split("?")[0], "postgres");
}

async function sqlOnPostgres(sql: string) {
  await run(
    pgBin("psql"),
    [postgresAdminUrl(), "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: { ...process.env, PGPASSWORD: dbPassword() }, allowWarn: false }
  );
}

type RunOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowWarn?: boolean;
};

function run(cmd: string, args: string[], opts: RunOpts = {}) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: 15 * 60 * 1000, cwd: opts.cwd, env: opts.env },
      (err, _out, stderr) => {
        const code = (err as NodeJS.ErrnoException & { code?: string | number })?.code;
        if (!err) return resolve();
        if (code === "ENOENT") {
          return reject(new BadRequestException(`${basename(cmd)} not found — set PG_BIN`));
        }
        const rawCode = (err as NodeJS.ErrnoException).code;
        const exit = typeof rawCode === "number" ? rawCode : 1;
        const text = (stderr || err.message || "").trim();
        // pg_restore often exits 1 for non-fatal warnings when using --clean
        if (opts.allowWarn && exit === 1 && !isFatalPgRestore(text)) {
          return resolve();
        }
        const msg = text.split("\n").slice(-6).join(" ").trim() || `Command failed (exit ${exit})`;
        reject(new BadRequestException(msg));
      }
    );
  });
}

function runCapture(cmd: string, args: string[], opts: RunOpts = {}) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: 60_000, cwd: opts.cwd, env: opts.env },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || "").trim().split("\n").slice(-4).join(" ");
          return reject(new BadRequestException(msg || "psql failed"));
        }
        resolve(String(stdout || ""));
      }
    );
  });
}

function isFatalPgRestore(stderr: string) {
  const s = stderr.toLowerCase();
  if (!s.trim()) return false;
  // Common non-fatal noise with --clean --if-exists
  if (/error:/i.test(stderr) && !/does not exist|already exists/i.test(stderr)) return true;
  if (/fatal:/i.test(stderr)) return true;
  if (/could not connect/i.test(stderr)) return true;
  return false;
}
