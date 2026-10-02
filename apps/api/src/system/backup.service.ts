import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { execFile } from "child_process";
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { dataDir } from "../config/env";

const KEEP = 30;
const KEEP_MONTHS = 24;
const DAILY_HOUR = 23;
const MONTHLY_REFRESH_MS = 12 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BackupFile = {
  file: string;
  size: number;
  createdAt: string;
  auto: boolean;
  kind: "daily" | "monthly" | "manual" | "safety";
};

@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Backup");
  private timer?: NodeJS.Timeout;
  private running = false;

  onApplicationBootstrap() {
    setTimeout(() => this.autoCheck(), 60_000);
    this.timer = setInterval(() => this.autoCheck(), CHECK_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  dir() {
    return process.env.BACKUP_DIR || dataDir("backups");
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

  async create(kind: "auto" | "manual" | "pre-restore" = "manual"): Promise<BackupFile> {
    if (this.running) throw new BadRequestException("Backup already running");
    this.running = true;
    try {
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const file = join(this.dir(), `hotel-${stamp}-${kind}.dump`);
      await run(pgBin("pg_dump"), ["--format=custom", "--no-owner", `--file=${file}`, `--dbname=${dbUrl()}`]);
      this.prune();
      this.log.log(`Backup saved: ${file}`);
      return this.list().find((b) => b.file === basename(file))!;
    } finally {
      this.running = false;
    }
  }

  async restore(file: string) {
    const safe = basename(file);
    const full = join(this.dir(), safe);
    if (!safe.endsWith(".dump") || !existsSync(full)) {
      throw new BadRequestException("Backup file not found");
    }
    await this.create("pre-restore");
    this.running = true;
    try {
      await run(pgBin("pg_restore"), [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--single-transaction",
        `--dbname=${dbUrl()}`,
        full,
      ]);
      this.log.warn(`Database restored from ${safe}`);
      return { ok: true, restored: safe };
    } finally {
      this.running = false;
    }
  }

  /**
   * One database file per month. The current month is replaced about once a day so a crash
   * can be restored to the latest copy; earlier months are left untouched.
   */
  async refreshMonthly() {
    if (this.running) return;
    const month = localMonth();
    const file = join(this.dir(), `hotel-${month}-monthly.dump`);
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MONTHLY_REFRESH_MS) return;
    this.running = true;
    const tmp = `${file}.tmp`;
    const prev = `${file}.prev`;
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
      await run(pgBin("pg_dump"), ["--format=custom", "--no-owner", `--file=${tmp}`, `--dbname=${dbUrl()}`]);
      if (existsSync(prev)) unlinkSync(prev);
      if (existsSync(file)) renameSync(file, prev);
      renameSync(tmp, file);
      if (existsSync(prev)) unlinkSync(prev);
      this.pruneMonthly();
      this.log.log(`Monthly backup updated: ${basename(file)}`);
    } catch (e) {
      if (existsSync(tmp)) unlinkSync(tmp);
      if (!existsSync(file) && existsSync(prev)) renameSync(prev, file);
      throw e;
    } finally {
      this.running = false;
    }
  }

  private prune() {
    const daily = this.list().filter((b) => b.kind === "daily");
    for (const b of daily.slice(KEEP)) unlinkSync(join(this.dir(), b.file));
  }

  private pruneMonthly() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS);
    const limit = localMonth(cutoff);
    for (const b of this.list()) {
      const m = /^hotel-(\d{4}-\d{2})-monthly\.dump$/.exec(b.file);
      if (m && m[1] < limit) unlinkSync(join(this.dir(), b.file));
    }
  }

  private async autoCheck() {
    if (this.running) return;
    const last = this.list().find((b) => b.kind === "daily");
    const age = last ? Date.now() - new Date(last.createdAt).getTime() : Infinity;
    const doneToday = last && new Date(last.createdAt).toDateString() === new Date().toDateString();
    if (age > DAY_MS || (!doneToday && new Date().getHours() >= DAILY_HOUR)) {
      try {
        await this.create("auto");
      } catch (e) {
        this.log.warn(`Auto backup failed: ${(e as Error).message}`);
      }
    }
    try {
      await this.refreshMonthly();
    } catch (e) {
      this.log.warn(`Monthly backup failed: ${(e as Error).message}`);
    }
  }
}

function localMonth(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

function kindOf(file: string): BackupFile["kind"] {
  if (file.includes("-monthly")) return "monthly";
  if (file.includes("-auto")) return "daily";
  if (file.includes("-pre-restore")) return "safety";
  return "manual";
}

function pgBin(name: string) {
  const dir = process.env.PG_BIN;
  if (!dir) return name;
  const exe = join(dir, process.platform === "win32" ? `${name}.exe` : name);
  return existsSync(exe) ? exe : name;
}

function dbUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new BadRequestException("DATABASE_URL not set");
  return url.split("?")[0];
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10 * 60 * 1000 }, (err, _out, stderr) => {
      if (!err) return resolve();
      const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `${basename(cmd)} not found — PostgreSQL tools missing (set PG_BIN)`
        : (stderr || err.message).trim().split("\n").slice(-3).join(" ");
      reject(new BadRequestException(msg));
    });
  });
}
