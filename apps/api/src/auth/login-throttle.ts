import { HttpException, HttpStatus } from "@nestjs/common";

const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

type Entry = { failures: number; lockedUntil: number };

/** In-memory brute-force guard for password and PIN logins (single server process). */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  assertAllowed(key: string) {
    const e = this.entries.get(key);
    if (!e || e.lockedUntil <= Date.now()) return;
    const secs = Math.ceil((e.lockedUntil - Date.now()) / 1000);
    throw new HttpException(
      `Too many failed attempts. Try again in ${secs} seconds.`,
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  fail(key: string) {
    const e = this.entries.get(key) ?? { failures: 0, lockedUntil: 0 };
    if (e.lockedUntil && e.lockedUntil <= Date.now()) e.failures = 0;
    e.failures += 1;
    e.lockedUntil = e.failures >= MAX_FAILURES ? Date.now() + LOCK_MS : 0;
    this.entries.set(key, e);
  }

  succeed(key: string) {
    this.entries.delete(key);
  }
}
