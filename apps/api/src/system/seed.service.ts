import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { basename, join, normalize, relative, sep } from "path";
import { BackupService } from "./backup.service";

export const SEED_CONFIRM = "YES SEED";

/** Files modified within this window show as "new" in Developer setup. */
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type SeedScriptInfo = {
  id: string;
  label: string;
  path: string;
  folder: "prisma" | "scripts";
  available: boolean;
  mtime?: string;
  size?: number;
  isNew?: boolean;
};

/** Friendly titles for known files; anything else uses the file name. */
const LABELS: Record<string, string> = {
  "prisma/seed.ts": "Full catalog (menu / store / recipes / roles)",
  "prisma/import-pdf-inventory.ts": "Inventory import (PDF stock sheet)",
  "scripts/seed-grocery-counter.ts": "Grocery counter seed",
};

/** Only treat these as runnable seeds (not every .ts helper). */
const SEED_FILE_RE = /^(seed|import)[-.].+\.ts$|^seed\.ts$|^import.+\.ts$/i;

@Injectable()
export class SeedService {
  private readonly log = new Logger(SeedService.name);
  private running = false;

  constructor(private readonly backups: BackupService) {}

  list(): { confirmPhrase: string; scripts: SeedScriptInfo[] } {
    const root = apiRoot();
    const byPath = new Map<string, SeedScriptInfo>();

    const now = Date.now();
    for (const folder of ["prisma", "scripts"] as const) {
      const dir = join(root, folder);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
        if (!SEED_FILE_RE.test(name)) continue;
        const path = `${folder}/${name}`;
        const abs = join(dir, name);
        const st = statSync(abs);
        byPath.set(path, {
          id: path,
          label: LABELS[path] ?? humanize(name),
          path,
          folder,
          available: true,
          mtime: st.mtime.toISOString(),
          size: st.size,
          isNew: now - st.mtimeMs <= NEW_WINDOW_MS,
        });
      }
    }

    // Known labels still appear (greyed out) if file missing on this install
    for (const [path, label] of Object.entries(LABELS)) {
      if (byPath.has(path)) continue;
      const folder = path.startsWith("scripts/") ? "scripts" : "prisma";
      byPath.set(path, {
        id: path,
        label,
        path,
        folder,
        available: false,
        isNew: false,
      });
    }

    const scripts = [...byPath.values()].sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      if (a.available !== b.available) return a.available ? -1 : 1;
      const am = a.mtime || "";
      const bm = b.mtime || "";
      if (am !== bm) return bm.localeCompare(am);
      return a.path.localeCompare(b.path);
    });

    return { confirmPhrase: SEED_CONFIRM, scripts };
  }

  async run(opts: {
    scriptId: string;
    confirm: string;
    backupFirst?: boolean;
  }): Promise<{ ok: true; script: string; log: string; backup?: string }> {
    if (opts.confirm?.trim() !== SEED_CONFIRM) {
      throw new BadRequestException(`Type ${SEED_CONFIRM} to confirm`);
    }
    if (this.running) throw new BadRequestException("Seed already running");

    const info = this.list().scripts.find((s) => s.id === opts.scriptId || s.path === opts.scriptId);
    if (!info?.available) throw new BadRequestException("Unknown or unavailable seed script");

    const root = apiRoot();
    const abs = resolveAllowed(root, info.path);
    const tsx = resolveTsx(root);
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new BadRequestException("DATABASE_URL is not set");

    this.running = true;
    try {
      let backupFile: string | undefined;
      if (opts.backupFirst !== false) {
        this.log.log("Creating safety backup before seed…");
        const b = await this.backups.create("pre-seed");
        backupFile = b.file;
      }

      this.log.log(`Running seed: ${info.path}`);
      const text = await runCapture(process.execPath, [tsx, abs], {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        timeoutMs: 15 * 60 * 1000,
      });
      this.log.log(`Seed finished: ${info.path}`);
      return {
        ok: true,
        script: info.path,
        log: trimTail(text),
        ...(backupFile ? { backup: backupFile } : {}),
      };
    } finally {
      this.running = false;
    }
  }
}

function humanize(fileName: string) {
  return fileName
    .replace(/\.ts$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function apiRoot() {
  return join(__dirname, "../..");
}

function resolveTsx(root: string) {
  const candidates = [
    join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    join(root, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new BadRequestException("tsx not found — cannot run seed scripts");
}

/** Only allow files under prisma/ or scripts/, no path escape. */
function resolveAllowed(root: string, relPosix: string) {
  const normalized = relPosix.replace(/\\/g, "/");
  if (
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    !/^(prisma|scripts)\/[A-Za-z0-9._-]+\.ts$/.test(normalized)
  ) {
    throw new BadRequestException("Invalid seed path");
  }
  if (!SEED_FILE_RE.test(basename(normalized))) {
    throw new BadRequestException("File is not a seed/import script");
  }
  const abs = normalize(join(root, ...normalized.split("/")));
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new BadRequestException("Invalid seed path");
  }
  if (!existsSync(abs)) {
    throw new BadRequestException(`Seed file missing: ${basename(abs)}`);
  }
  return abs;
}

function trimTail(text: string, max = 4000) {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(t.length - max);
}

function runCapture(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        timeout: opts.timeoutMs,
        cwd: opts.cwd,
        env: opts.env,
        maxBuffer: 8 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const text = `${stdout || ""}\n${stderr || ""}`.trim();
        if (err) {
          const msg =
            trimTail(text, 800) ||
            (err as Error).message ||
            `Seed failed (exit ${(err as NodeJS.ErrnoException).code ?? 1})`;
          return reject(new BadRequestException(msg));
        }
        resolve(text || "Seed OK");
      }
    );
  });
}
