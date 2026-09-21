/**
 * Ask the agent a question from the terminal and watch it work.
 *
 *   pnpm ask "Which month had the lowest revenue?" samples/sales.csv
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent } from "../src/agent.js";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const [question, ...filePaths] = process.argv.slice(2);
if (!question) {
  console.error('usage: pnpm ask "<question>" [file ...]');
  process.exit(1);
}

const files = await Promise.all(
  filePaths.map(async (p) => ({
    name: path.basename(p),
    content: await readFile(p, "utf8"),
  })),
);

const res = await fetch(`${BASE_URL}/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question, files }),
});
if (!res.ok || !res.body) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const indent = (s: string) => s.trim().split("\n").map((l) => "    " + l).join("\n");

// Parse the SSE stream line by line as it arrives.
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf("\n\n")) >= 0) {
    const frame = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    if (!frame.startsWith("data: ")) continue;
    show(JSON.parse(frame.slice(6)) as AgentEvent);
  }
}

function show(e: AgentEvent): void {
  switch (e.type) {
    case "model_call":
      console.log(dim(`\n[step ${e.step}] asking the model…`));
      break;
    case "tool_call":
      console.log(bold(`[step ${e.step}] model wants to run:`));
      console.log(indent(e.code));
      break;
    case "tool_result": {
      const r = e.result;
      const tag = r.timedOut ? "TIMEOUT" : r.oomKilled ? "OOM" : `exit ${r.exitCode}`;
      console.log(bold(`[step ${e.step}] sandbox → ${tag} in ${r.durationMs} ms`));
      if (r.stdout.trim()) console.log(indent(r.stdout));
      if (r.stderr.trim()) console.log("\x1b[31m" + indent(r.stderr) + "\x1b[0m");
      if (r.producedFiles.length) console.log(dim(`    wrote: ${r.producedFiles.join(", ")}`));
      break;
    }
    case "answer":
      console.log(`\n${bold("Answer:")} ${e.text}`);
      break;
    case "usage": {
      const u = e.usage;
      console.log(
        dim(
          `\n${u.modelCalls} model calls · ${u.steps} sandbox runs · ` +
            `${u.inputTokens} in / ${u.outputTokens} out / ${u.thoughtTokens} thinking tokens`,
        ),
      );
      break;
    }
    case "error":
      console.log(`\x1b[31mError: ${e.message}\x1b[0m`);
      break;
  }
}
