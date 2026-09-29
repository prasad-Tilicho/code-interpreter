/**
 * Sends every attacks/*.py to POST /run and prints a table.
 * Run the server first:  pnpm dev
 * Then:                  pnpm attacks
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const here = path.dirname(fileURLToPath(import.meta.url));
const attacksDir = path.resolve(here, "..", "attacks");

interface RunData {
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  oomKilled: boolean;
  compileFailed: boolean;
  stdout: string;
  stderr: string;
}

/**
 * The file extension decides the language. That is the whole point of running
 * these: the .c and .java attacks never touch a Python interpreter, and they
 * hit exactly the same kernel limits. The fence is around the process, not
 * around the language.
 */
const LANG_BY_EXT: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".c": "c",
  ".cpp": "cpp",
  ".java": "java",
  ".sh": "bash",
};

const files = (await readdir(attacksDir))
  .filter((f) => LANG_BY_EXT[path.extname(f)])
  .sort();

const rows: string[][] = [
  ["attack", "lang", "exit", "time", "flags", "last line"],
];

for (const file of files) {
  const code = await readFile(path.join(attacksDir, file), "utf8");
  const language = LANG_BY_EXT[path.extname(file)]!;
  process.stdout.write(`running ${file} (${language}) ... `);
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, language }),
  });
  const body = (await res.json()) as {
    ok: boolean;
    data?: RunData;
    error?: string;
  };
  if (!body.ok || !body.data) {
    console.log(`server error: ${body.error}`);
    rows.push([
      file,
      language,
      "?",
      `${Date.now() - started}ms`,
      "ERROR",
      body.error ?? "",
    ]);
    continue;
  }
  const d = body.data;
  const flags = [
    d.timedOut && "TIMEOUT",
    d.oomKilled && "OOM",
    d.compileFailed && "COMPILE-FAIL",
  ]
    .filter(Boolean)
    .join(",");
  const last = lastLine(d.stderr) || lastLine(d.stdout);
  console.log(`exit ${d.exitCode} in ${d.durationMs}ms`);
  rows.push([
    file,
    language,
    String(d.exitCode),
    `${d.durationMs}ms`,
    flags || "-",
    last,
  ]);
}

console.log("\n" + table(rows));

function lastLine(s: string): string {
  const lines = s.trim().split("\n").filter(Boolean);
  return (lines[lines.length - 1] ?? "").slice(0, 70);
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (r: string[]) =>
    r.map((c, i) => (c ?? "").padEnd(widths[i]!)).join("  ");
  return [
    line(rows[0]!),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.slice(1).map(line),
  ].join("\n");
}
