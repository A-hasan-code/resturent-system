import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { platform } from "os";
import { join, resolve } from "path";

export const SHELL_CONFIRM = "YES SHELL";

const MAX_CMD = 4000;
const MAX_OUT = 200_000;
const TIMEOUT_MS = 60_000;

@Injectable()
export class DeveloperShellService {
  private readonly log = new Logger(DeveloperShellService.name);
  private running = false;

  /** Monorepo root (has package.json with hotel:dev) or installed app folder. */
  workspaceRoot(): string {
    return resolveWorkspaceRoot();
  }

  async run(opts: { command: string; confirm: string }): Promise<{
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    ms: number;
    cwd: string;
  }> {
    if (opts.confirm?.trim() !== SHELL_CONFIRM) {
      throw new BadRequestException(`Type ${SHELL_CONFIRM} to confirm`);
    }
    if (platform() !== "win32") {
      throw new BadRequestException("PowerShell runner is only available on Windows servers");
    }
    const command = (opts.command || "").trim();
    if (!command) throw new BadRequestException("Command is empty");
    if (command.length > MAX_CMD) throw new BadRequestException(`Command too long (max ${MAX_CMD})`);
    if (this.running) throw new BadRequestException("A shell command is already running");

    const cwd = resolveWorkspaceRoot();
    this.running = true;
    const started = Date.now();
    this.log.warn(`Developer PowerShell (cwd=${cwd}): ${command.slice(0, 200)}`);

    try {
      const result = await runPs(command, cwd);
      return {
        ok: result.code === 0,
        code: result.code,
        stdout: trimOut(result.stdout),
        stderr: trimOut(stripClixml(result.stderr)),
        ms: Date.now() - started,
        cwd,
      };
    } finally {
      this.running = false;
    }
  }
}

/** Walk up from cwd / __dirname until we find hotel-system package.json (or stop). */
export function resolveWorkspaceRoot(): string {
  const starts = [process.cwd(), join(__dirname, "../../.."), join(__dirname, "../../../..")];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      const pkg = join(dir, "package.json");
      if (existsSync(pkg)) {
        try {
          const raw = readFileSync(pkg, "utf8");
          if (raw.includes('"hotel:dev"') || raw.includes('"name": "hotel-system"')) {
            return dir;
          }
        } catch {
          /* ignore */
        }
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}

function trimOut(text: string) {
  const t = text || "";
  if (t.length <= MAX_OUT) return t;
  return `${t.slice(0, MAX_OUT)}\n… [truncated]`;
}

/** PowerShell often dumps CLIXML progress noise on stderr. */
function stripClixml(text: string) {
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .filter((line) => !line.includes("CLIXML") && !line.includes("<Objs Version=") && !line.includes("</Objs>"))
    .join("\n")
    .trim();
}

function runPs(command: string, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Silence progress + set location, then run user script.
    const wrapped = [
      "$ProgressPreference = 'SilentlyContinue'",
      "$ErrorActionPreference = 'Continue'",
      `Set-Location -LiteralPath ${psQuote(cwd)}`,
      command,
    ].join("; ");
    const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUT,
        cwd,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        let code: number | null = 0;
        if (err) {
          const c = (err as NodeJS.ErrnoException & { code?: string | number }).code;
          code = typeof c === "number" ? c : 1;
          if ((err as Error).message?.includes("TIMEOUT") || /timed out/i.test(String(err))) {
            return resolve({
              code: 1,
              stdout: String(stdout || ""),
              stderr: `${stderr || ""}\nCommand timed out after ${TIMEOUT_MS / 1000}s`.trim(),
            });
          }
        }
        resolve({
          code,
          stdout: String(stdout || ""),
          stderr: String(stderr || (err && code !== 0 ? err.message : "") || ""),
        });
      }
    );
  });
}

function psQuote(path: string) {
  return `'${path.replace(/'/g, "''")}'`;
}
