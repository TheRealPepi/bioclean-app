/// <reference types="vite/client" />
import { expect, test } from "vitest";

// A tripwire, not a proof: it reads the source of every function module and
// fails when new code skips one of the habits that keep companies apart
// (see `convex/lib/access.ts`). `isolation.test.ts` checks the behaviour.
//
// When one of these fails on code that is right, say why on that line with a
// `// tenant-ok: …` comment (or `// guard: …` for the first rule).

const sources = import.meta.glob<string>(["./*.ts", "!./*.test.ts", "!./*.*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const modules = Object.entries(sources).filter(([path]) => !/\/(auth|auth\.config|http|schema|crons)\.ts$/.test(path));

/** Rows of these tables belong to one company. */
const TENANT_TABLES = [
  "clients",
  "vehicles",
  "deliveries",
  "invoiceNumbers",
  "routes",
  "reminders",
  "members",
  "companySecrets",
  "companies",
];

const GUARD = /await require(User|Office|Admin)\(ctx|await getViewer\(ctx\)|\/\/ guard:/;

test("there are function modules to check", () => {
  expect(modules.map(([path]) => path).sort()).toEqual(
    expect.arrayContaining(["./clients.ts", "./companies.ts", "./deliveries.ts", "./members.ts"]),
  );
});

test("every public function starts by checking who is calling", () => {
  const unguarded: string[] = [];
  for (const [path, source] of modules) {
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      const name = /^export const (\w+) = (query|mutation|action)\(/.exec(line)?.[1];
      if (!name) return;
      const handler = lines.findIndex((l, j) => j > i && /^\s*handler: async \(/.test(l));
      // The guard is the handler's first statement (a comment may come first).
      const first = lines.slice(handler + 1, handler + 3).join("\n");
      if (handler === -1 || !GUARD.test(first)) unguarded.push(`${path}: ${name}`);
    });
  }
  expect(unguarded).toEqual([]);
});

test("a row is only read by id through getOwned", () => {
  const direct: string[] = [];
  for (const [path, source] of modules) {
    source.split("\n").forEach((line, i) => {
      if (/ctx\.db\.get\(/.test(line) && !/\/\/ tenant-ok/.test(`${line}\n${source.split("\n")[i - 1]}`)) {
        direct.push(`${path}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(direct).toEqual([]);
});

test("a company's tables are only read through an index", () => {
  const scans: string[] = [];
  for (const [path, source] of modules) {
    const lines = source.split("\n");
    lines.forEach((line, i) => {
      const table = /\.query\("(\w+)"\)/.exec(line)?.[1];
      if (!table || !TENANT_TABLES.includes(table)) return;
      const here = `${lines[i - 1]}\n${line}\n${lines[i + 1] ?? ""}`;
      if (!/\.withIndex\(/.test(here) && !/\/\/ tenant-ok/.test(here)) {
        scans.push(`${path}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(scans).toEqual([]);
});
