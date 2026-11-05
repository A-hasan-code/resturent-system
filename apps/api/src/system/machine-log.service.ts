import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { hostname } from "os";
import { dataDir } from "../config/env";

export type MachineLogLevel = "info" | "warn" | "error";

export type MachineLogEntry = {
  at: string;
  machineId: string;
  machineName: string;
  level: MachineLogLevel;
  message: string;
  meta?: Record<string, unknown>;
};

const MAX_MEMORY = 2500;
const MAIN_ID = "main";

@Injectable()
export class MachineLogService implements OnModuleInit {
  private readonly memory: MachineLogEntry[] = [];
  private logDir = "";

  onModuleInit() {
    this.logDir = dataDir("logs");
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    this.write(MAIN_ID, hostname() || "Main server", "info", "Server started — machine logs ready");
  }

  mainId() {
    return MAIN_ID;
  }

  write(
    machineId: string,
    machineName: string,
    level: MachineLogLevel,
    message: string,
    meta?: Record<string, unknown>
  ) {
    const entry: MachineLogEntry = {
      at: new Date().toISOString(),
      machineId: (machineId || MAIN_ID).slice(0, 80),
      machineName: (machineName || machineId || "machine").slice(0, 80),
      level,
      message: String(message || "").slice(0, 500),
      ...(meta ? { meta } : {}),
    };
    this.memory.push(entry);
    while (this.memory.length > MAX_MEMORY) this.memory.shift();
    try {
      if (!this.logDir) this.logDir = dataDir("logs");
      const day = entry.at.slice(0, 10);
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(join(this.logDir, `machines-${day}.log`), line, "utf8");
    } catch {
      /* disk full — keep memory only */
    }
  }

  info(machineId: string, machineName: string, message: string, meta?: Record<string, unknown>) {
    this.write(machineId, machineName, "info", message, meta);
  }

  warn(machineId: string, machineName: string, message: string, meta?: Record<string, unknown>) {
    this.write(machineId, machineName, "warn", message, meta);
  }

  error(machineId: string, machineName: string, message: string, meta?: Record<string, unknown>) {
    this.write(machineId, machineName, "error", message, meta);
  }

  /** Distinct machines seen in memory + today's file (for Settings picker). */
  machines(): { id: string; name: string }[] {
    const map = new Map<string, string>();
    map.set(MAIN_ID, hostname() || "Main server");
    for (const e of this.memory) map.set(e.machineId, e.machineName);
    for (const e of this.readTodayFile().slice(-200)) map.set(e.machineId, e.machineName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }

  /**
   * Recent lines for one machine or all.
   * Combines today's file + memory (deduped by at+message).
   */
  list(opts?: { machineId?: string; limit?: number }): {
    machines: { id: string; name: string }[];
    entries: MachineLogEntry[];
  } {
    const limit = Math.min(Math.max(opts?.limit ?? 150, 20), 500);
    const want = opts?.machineId?.trim() || "";
    const fromFile = this.readTodayFile();
    const merged = [...fromFile, ...this.memory];
    const seen = new Set<string>();
    const out: MachineLogEntry[] = [];
    for (let i = merged.length - 1; i >= 0; i--) {
      const e = merged[i];
      if (want && want !== "all" && e.machineId !== want) continue;
      const key = `${e.at}|${e.machineId}|${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
      if (out.length >= limit) break;
    }
    out.reverse();
    return { machines: this.machines(), entries: out };
  }

  private readTodayFile(): MachineLogEntry[] {
    try {
      if (!this.logDir) this.logDir = dataDir("logs");
      const day = new Date().toISOString().slice(0, 10);
      const file = join(this.logDir, `machines-${day}.log`);
      if (!existsSync(file)) return [];
      // Cap read size (~2MB) so Settings stays snappy.
      const st = statSync(file);
      const raw =
        st.size > 2_000_000
          ? readFileSync(file, "utf8").slice(-2_000_000)
          : readFileSync(file, "utf8");
      const rows: MachineLogEntry[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as MachineLogEntry;
          if (o?.at && o?.message) rows.push(o);
        } catch {
          /* skip bad line */
        }
      }
      return rows;
    } catch {
      return [];
    }
  }

  /** Drop log files older than keepDays (best-effort). */
  prune(keepDays = 14) {
    try {
      if (!this.logDir || !existsSync(this.logDir)) return;
      const cutoff = Date.now() - keepDays * 86400000;
      for (const name of readdirSync(this.logDir)) {
        if (!/^machines-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
        const p = join(this.logDir, name);
        if (statSync(p).mtimeMs < cutoff) {
          try {
            unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}
