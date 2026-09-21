/**
 * POST /chat { question, files?: [{ name, content }] }
 *
 * Streams the agent's progress as Server-Sent Events — one `data:` line per
 * AgentEvent — so a caller sees the code being written, run, and corrected
 * as it happens instead of a 30-second silence followed by an answer.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runAgent, type AgentEvent } from "../agent.js";
import type { Llm } from "../llm.js";

const ChatBody = z.object({
  question: z.string().min(1).max(4_000),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        content: z.string().max(2_000_000),
      }),
    )
    .max(5)
    .default([]),
});

export async function chatRoutes(
  app: FastifyInstance,
  opts: { llm: Llm },
): Promise<void> {
  app.post("/chat", async (request, reply) => {
    const parsed = ChatBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ ok: false, error: parsed.error.issues[0]?.message });
    }

    // Take over the socket: Fastify's JSON serialiser can't do a live stream.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

    try {
      await runAgent({
        question: parsed.data.question,
        files: parsed.data.files,
        llm: opts.llm,
        onEvent: send,
      });
    } catch (err) {
      request.log.error({ err }, "agent failed");
      send({ type: "error", message: (err as Error).message });
    } finally {
      res.end();
    }
  });
}
