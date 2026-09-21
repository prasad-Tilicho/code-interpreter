/**
 * POST /run { code } → the raw sandbox, no AI in between.
 * This is what the attack scripts hit, and what the Day-3 agent will call.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runPython } from "../sandbox.js";

const RunBody = z.object({
  code: z.string().min(1).max(100_000),
});

export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.post("/run", async (request, reply) => {
    const parsed = RunBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ ok: false, error: parsed.error.issues[0]?.message });
    }
    try {
      const result = await runPython(parsed.data.code);
      return { ok: true, data: result };
    } catch (err) {
      request.log.error({ err }, "sandbox run failed");
      return reply
        .code(500)
        .send({ ok: false, error: "sandbox failed — see server log" });
    }
  });
}
