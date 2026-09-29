import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { pickLlm } from "./llm.js";
import { chatRoutes } from "./routes/chat.js";
import { fileRoutes } from "./routes/files.js";
import { runRoutes } from "./routes/run.js";
import { assertSandboxReady, isOn, LIMITS } from "./sandbox.js";
import { RUNTIMES } from "./runtimes.js";

const PORT = Number(process.env.PORT ?? 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(here, "..", "public", "index.html");

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.get("/health", async () => ({ ok: true }));
app.get("/", async (_req, reply) =>
  reply.type("text/html; charset=utf-8").send(await readFile(PAGE)),
);
await app.register(runRoutes);
await app.register(fileRoutes);

let llm;
let languages: string[] = [];
try {
  languages = await assertSandboxReady();
  llm = pickLlm();
} catch (err) {
  app.log.error((err as Error).message);
  process.exit(1);
}
await app.register(chatRoutes, { llm });

const protections = (
  ["memory", "pids", "network", "readonly", "timeout", "user"] as const
).map((p) => `${p}=${isOn(p) ? "on" : "OFF"}`);

app.log.info({ limits: LIMITS }, "sandbox ready");
const missing = RUNTIMES.filter((r) => !languages.includes(r.id)).map(
  (r) => r.id,
);
app.log.info(`languages: ${languages.join(", ")}`);
if (missing.length > 0) {
  app.log.warn(`not built (run pnpm sandbox:build): ${missing.join(", ")}`);
}
app.log.info(`protections: ${protections.join("  ")}`);
app.log.info(`model: ${llm.name}`);

await app.listen({ port: PORT, host: "127.0.0.1" });
app.log.info(`open http://127.0.0.1:${PORT}`);
