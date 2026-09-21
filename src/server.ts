import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { pickLlm } from "./llm.js";
import { chatRoutes } from "./routes/chat.js";
import { fileRoutes } from "./routes/files.js";
import { runRoutes } from "./routes/run.js";
import { assertSandboxReady, IMAGE, isOn, LIMITS } from "./sandbox.js";

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
try {
  await assertSandboxReady();
  llm = pickLlm();
} catch (err) {
  app.log.error((err as Error).message);
  process.exit(1);
}
await app.register(chatRoutes, { llm });

const protections = (
  ["memory", "pids", "network", "readonly", "timeout", "user"] as const
).map((p) => `${p}=${isOn(p) ? "on" : "OFF"}`);

app.log.info({ image: IMAGE, limits: LIMITS }, "sandbox ready");
app.log.info(`protections: ${protections.join("  ")}`);
app.log.info(`model: ${llm.name}`);

await app.listen({ port: PORT, host: "127.0.0.1" });
app.log.info(`open http://127.0.0.1:${PORT}`);
