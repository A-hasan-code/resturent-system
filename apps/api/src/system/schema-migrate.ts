import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export type MigrateLog = (msg: string) => void;

/**
 * Production-safe `prisma migrate deploy` with recovery for:
 * - P3009 (failed migration row left behind)
 * - P3018 / "already exists" (partial apply — mark applied and continue)
 *
 * Used by restore, API boot heal, and any other schema upgrade path.
 */
export async function migrateDeploy(opts: {
  apiRoot: string;
  databaseUrl: string;
  log?: MigrateLog;
}): Promise<void> {
  const { apiRoot, databaseUrl } = opts;
  const log = opts.log ?? (() => undefined);
  const node = process.execPath;
  // pnpm often hoists prisma to the workspace root, not apps/api/node_modules.
  const candidates = [
    join(apiRoot, "node_modules", "prisma", "build", "index.js"),
    join(apiRoot, "..", "..", "node_modules", "prisma", "build", "index.js"),
  ];
  const prismaJs = candidates.find((p) => existsSync(p));
  if (!prismaJs) {
    throw new Error(`Prisma CLI missing (tried: ${candidates.join(", ")})`);
  }
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
  const schema = "prisma/schema.prisma";
  const deployArgs = [prismaJs, "migrate", "deploy", "--schema", schema];

  const first = await runCapture(node, deployArgs, { cwd: apiRoot, env });
  if (first.code === 0) {
    log("migrate deploy OK");
    return;
  }

  const text = first.text;
  const names = parseMigrationNames(text);
  const isFailedRow = /P3009|failed migrations/i.test(text);
  const isPartial = /P3018|already exists|duplicate key/i.test(text);

  if (!isFailedRow && !isPartial) {
    throw new Error(trimErr(text) || `migrate deploy failed (exit ${first.code})`);
  }
  if (!names.length) {
    throw new Error(
      trimErr(text) || "migrate failed but could not parse migration name for recovery"
    );
  }

  if (isFailedRow || (isPartial && /failed migrations|P3009/i.test(text))) {
    for (const name of names) {
      log(`Resolving failed migration as rolled-back: ${name}`);
      await runCapture(node, [prismaJs, "migrate", "resolve", "--rolled-back", name, "--schema", schema], {
        cwd: apiRoot,
        env,
      });
    }
    const second = await runCapture(node, deployArgs, { cwd: apiRoot, env });
    if (second.code === 0) {
      log("migrate deploy OK after rolled-back resolve");
      return;
    }
    const text2 = second.text;
    if (!/P3018|already exists|duplicate key|P3009|failed migrations/i.test(text2)) {
      throw new Error(trimErr(text2) || `migrate deploy failed (exit ${second.code})`);
    }
    const names2 = parseMigrationNames(text2);
    const toApply = names2.length ? names2 : names;
    for (const name of toApply) {
      log(`Marking migration applied (partial / already exists): ${name}`);
      await runCapture(node, [prismaJs, "migrate", "resolve", "--applied", name, "--schema", schema], {
        cwd: apiRoot,
        env,
      });
    }
    const third = await runCapture(node, deployArgs, { cwd: apiRoot, env });
    if (third.code !== 0) {
      throw new Error(trimErr(third.text) || `migrate deploy still failing (exit ${third.code})`);
    }
    log("migrate deploy OK after applied resolve");
    return;
  }

  // Direct P3018 on first deploy (failed mid-migration without clean P3009 wording)
  for (const name of names) {
    log(`Marking migration applied (already exists): ${name}`);
    await runCapture(node, [prismaJs, "migrate", "resolve", "--applied", name, "--schema", schema], {
      cwd: apiRoot,
      env,
    });
  }
  const retry = await runCapture(node, deployArgs, { cwd: apiRoot, env });
  if (retry.code !== 0) {
    throw new Error(trimErr(retry.text) || `migrate deploy still failing (exit ${retry.code})`);
  }
  log("migrate deploy OK after direct P3018 recovery");
}

function parseMigrationNames(text: string): string[] {
  const a = [...text.matchAll(/The\s+`([0-9]{14}_[A-Za-z0-9_]+)`\s+migration/g)].map((m) => m[1]);
  const b = [...text.matchAll(/The\s+.([0-9]{14}_[A-Za-z0-9_]+).\s+migration/g)].map((m) => m[1]);
  const c = [...text.matchAll(/Migration name:\s*(\S+)/g)].map((m) => m[1]);
  const d = [...text.matchAll(/Applying migration `([0-9]{14}_[A-Za-z0-9_]+)`/g)].map((m) => m[1]);
  return [...new Set([...a, ...b, ...c, ...d].filter(Boolean))];
}

function trimErr(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" ");
}

function runCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: 10 * 60 * 1000, cwd: opts.cwd, env: opts.env, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const text = `${stdout || ""}\n${stderr || ""}\n${err?.message || ""}`;
        let code = 0;
        if (err) {
          const c = (err as NodeJS.ErrnoException).code;
          code = typeof c === "number" ? c : 1;
        }
        resolve({ code, text });
      }
    );
  });
}
