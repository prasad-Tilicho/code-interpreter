import Fastify from "fastify";
import { pickLlm } from "./llm.js";
import { chatRoutes } from "./routes/chat.js";
import { runRoutes } from "./routes/run.js";
import { assertSandboxReady, IMAGE, isOn, LIMITS } from "./sandbox.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.get("/health", async () => ({ ok: true }));
await app.register(runRoutes);

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
