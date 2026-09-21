import Fastify from "fastify";
import { runRoutes } from "./routes/run.js";
import { assertSandboxReady, IMAGE, isOn, LIMITS } from "./sandbox.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.get("/health", async () => ({ ok: true }));
await app.register(runRoutes);

try {
  await assertSandboxReady();
} catch (err) {
  app.log.error((err as Error).message);
  process.exit(1);
}

const protections = (
  ["memory", "pids", "network", "readonly", "timeout", "user"] as const
).map((p) => `${p}=${isOn(p) ? "on" : "OFF"}`);

app.log.info({ image: IMAGE, limits: LIMITS }, "sandbox ready");
app.log.info(`protections: ${protections.join("  ")}`);

await app.listen({ port: PORT, host: "127.0.0.1" });
