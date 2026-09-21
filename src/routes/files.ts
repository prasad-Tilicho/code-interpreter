/**
 * GET /jobs/:jobId/:name → a file the sandboxed code produced (a chart, a CSV).
 *
 * The only way bytes get from a box to a browser. Both path segments are
 * untrusted: the jobId must be a UUID we minted, and the name is reduced to
 * its basename so "../../.env" cannot climb out of the job folder.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const JOBS_DIR = path.resolve(process.env.JOBS_DIR ?? "jobs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { jobId: string; name: string } }>(
    "/jobs/:jobId/:name",
    async (request, reply) => {
      const { jobId } = request.params;
      const name = path.basename(request.params.name);
      if (!UUID.test(jobId) || name === "main.py") {
        return reply.code(404).send({ ok: false, error: "not found" });
      }
      const file = path.join(JOBS_DIR, jobId, name);
      try {
        const s = await stat(file);
        if (!s.isFile()) throw new Error("not a file");
      } catch {
        return reply.code(404).send({ ok: false, error: "not found" });
      }
      const type = MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
      return reply.type(type).send(createReadStream(file));
    },
  );
}
