/**
 * POST /run { code } → the raw sandbox, no AI in between.
 * This is what the attack scripts hit, and what the Day-3 agent will call.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { run } from "../sandbox.js";
import { RUNTIMES } from "../runtimes.js";

const RunBody = z.object({
  code: z.string().min(1).max(100_000),
  // A language id is untrusted input like everything else: an enum, not a
  // string that gets interpolated into a command.
  language: z
    .enum(RUNTIMES.map((r) => r.id) as [string, ...string[]])
    .optional(),
});

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // The UI asks for this to build its language menu, so the list lives in one
  // place instead of being duplicated in the page.
  app.get("/languages", async () => ({
    ok: true,
    data: RUNTIMES.map((r) => ({
      id: r.id,
      label: r.label,
      notes: r.notes,
      hello: r.hello,
      compiled: Boolean(r.compile),
    })),
  }));

  app.post("/run", async (request, reply) => {
    const parsed = RunBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ ok: false, error: parsed.error.issues[0]?.message });
    }
    try {
      const result = await run(parsed.data.code, {
        language: parsed.data.language,
      });
      return { ok: true, data: result };
    } catch (err) {
      request.log.error({ err }, "sandbox run failed");
      return reply
        .code(500)
        .send({ ok: false, error: "sandbox failed — see server log" });
    }
  });
}
