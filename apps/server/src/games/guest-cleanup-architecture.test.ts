import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Feature: anonymous-sign-in
//
// Smoke / architecture check for Task 16.4.
//
// Two guarantees are asserted here against the ACTUAL repo on disk (no mocks):
//
//   1. SCHEDULING + CASCADE (R8.3 / R8.6): the delivered artifact
//      supabase/migrations/*_guest_cleanup.sql schedules the cleanup via
//      pg_cron on a 24h cadence (cron.schedule with the daily cron expression
//      '0 0 * * *'), defines cleanup_anonymous_accounts() whose body deletes
//      from auth.users on `is_anonymous = true`, and contains NO separate
//      stats-deletion statement (no `delete from race_stats /
//      battle_royale_stats / profiles`) — it relies on the FK cascade.
//
//   2. NO APPLICATION-CODE CLEANUP PATH (R8.4): cleanup exists ONLY as the SQL
//      artifact. A scan of the apps/server and apps/client `src` trees finds no
//      runtime code that deletes anonymous users or schedules cleanup
//      (cleanup_anonymous_accounts, admin.deleteUser, cron.schedule, ...).
//
// The cleanup is a delivered database artifact, deliberately not implemented in
// the app runtime, which this test locks in.

// ---------------------------------------------------------------------------
// Repo-root resolution
// ---------------------------------------------------------------------------
// This file lives at apps/server/src/games/guest-cleanup-architecture.test.ts,
// so the monorepo root is four directories up.
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..", "..");

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

const SRC_ROOTS = [
  join(REPO_ROOT, "apps", "server", "src"),
  join(REPO_ROOT, "apps", "client", "src"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Locate the single *_guest_cleanup.sql migration on disk.
const findGuestCleanupSql = (): string => {
  const matches = readdirSync(MIGRATIONS_DIR).filter((name) =>
    name.endsWith("_guest_cleanup.sql"),
  );
  expect(
    matches.length,
    "expected exactly one *_guest_cleanup.sql migration artifact",
  ).toBe(1);
  return join(MIGRATIONS_DIR, matches[0]);
};

// Recursively collect .ts/.tsx source files under a root, skipping test files,
// generated output, and node_modules so the scan only covers runtime app code.
const collectSourceFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const info = statSync(full);
      if (info.isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") {
          continue;
        }
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      // Skip tests (this file would otherwise match its own patterns) and
      // declaration files.
      if (/\.test\.(ts|tsx)$/.test(entry)) continue;
      if (entry.endsWith(".d.ts")) continue;
      out.push(full);
    }
  };
  walk(root);
  return out;
};

describe("guest cleanup — scheduling + cascade (R8.3 / R8.6)", () => {
  const sql = readFileSync(findGuestCleanupSql(), "utf8");
  // Normalize whitespace for robust phrase matching across line breaks.
  const flat = sql.replace(/\s+/g, " ").toLowerCase();

  it("enables pg_cron and schedules via cron.schedule", () => {
    expect(flat).toContain("create extension if not exists pg_cron");
    expect(flat).toContain("cron.schedule");
  });

  it("schedules on a 24h (daily) cadence with the '0 0 * * *' cron expression", () => {
    // The daily cron expression — minute 0, hour 0, every day — is the 24h
    // cadence required by R8.3.
    expect(sql).toMatch(/'0 0 \* \* \*'/);
    // And it is the schedule argument, so the scheduled job is the daily one.
    expect(flat).toMatch(/cron\.schedule\s*\(\s*'cleanup_anonymous_accounts'\s*,\s*'0 0 \* \* \*'/);
  });

  it("defines cleanup_anonymous_accounts() that deletes aged anonymous auth.users", () => {
    expect(flat).toMatch(
      /create or replace function [a-z.]*cleanup_anonymous_accounts\s*\(\s*\)/,
    );
    expect(flat).toContain("delete from auth.users");
    expect(flat).toContain("is_anonymous = true");
    // Age predicate — relies on now() - created_at over a 24h interval.
    expect(flat).toContain("interval '24 hours'");
  });

  it("has NO separate stats-deletion statement — relies on the FK cascade (R8.6)", () => {
    // No DELETE should ever target the cascaded tables; removing the auth.users
    // row must be the sole delete, with profiles/race_stats/battle_royale_stats
    // removed by onDelete: cascade.
    expect(flat).not.toMatch(/delete\s+from\s+(public\.)?race_stats/);
    expect(flat).not.toMatch(/delete\s+from\s+(public\.)?battle_royale_stats/);
    expect(flat).not.toMatch(/delete\s+from\s+(public\.)?profiles/);

    // auth.users is the only DELETE target in the artifact.
    const deleteTargets = [...flat.matchAll(/delete\s+from\s+([a-z_.]+)/g)].map(
      (m) => m[1],
    );
    expect(deleteTargets).toEqual(["auth.users"]);
  });
});

describe("guest cleanup — no application-code cleanup path (R8.4)", () => {
  // Runtime patterns that would indicate the cleanup/scheduling leaked into app
  // code instead of living solely in the SQL artifact.
  const forbiddenPatterns: { label: string; re: RegExp }[] = [
    { label: "cleanup_anonymous_accounts reference", re: /cleanup_anonymous_accounts/ },
    { label: "cleanupAnonymous* helper", re: /cleanupanonymous/i },
    { label: "admin deleteUser call", re: /\.deleteuser\s*\(/i },
    { label: "pg_cron cron.schedule in app code", re: /cron\.schedule/ },
    { label: "cron.unschedule in app code", re: /cron\.unschedule/ },
  ];

  it("scans at least one source file in each app src tree", () => {
    for (const root of SRC_ROOTS) {
      const files = collectSourceFiles(root);
      expect(files.length, `expected source files under ${root}`).toBeGreaterThan(0);
    }
  });

  it("finds no runtime code that deletes anonymous users or schedules cleanup", () => {
    const violations: string[] = [];

    for (const root of SRC_ROOTS) {
      for (const file of collectSourceFiles(root)) {
        const contents = readFileSync(file, "utf8").toLowerCase();
        for (const { label, re } of forbiddenPatterns) {
          if (re.test(contents)) {
            violations.push(`${label} -> ${file}`);
          }
        }
      }
    }

    expect(
      violations,
      `cleanup must live only in the SQL artifact; found app-code cleanup path(s):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
