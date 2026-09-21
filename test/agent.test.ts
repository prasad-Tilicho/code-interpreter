/**
 * The agent loop, driven by the scripted stub model. Exercises the real
 * sandbox, so Docker + image are required — but no API key and no tokens.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runAgent, type AgentEvent } from "../src/agent.js";
import { stubLlm } from "../src/llm.js";

describe("agent loop (stub model)", () => {
  it("runs code, sees the error, retries, and answers", async () => {
    const events: AgentEvent[] = [];
    const csv = await readFile("samples/sales.csv", "utf8");

    const result = await runAgent({
      question: "What is the total revenue?",
      files: [{ name: "sales.csv", content: csv }],
      llm: stubLlm(),
      onEvent: (e) => events.push(e),
    });

    // Two sandbox runs: the first fails on a bad column, the second succeeds.
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.result.exitCode).toBe(1);
    expect(result.steps[0]!.result.stderr).toContain("KeyError");
    expect(result.steps[1]!.result.exitCode).toBe(0);
    expect(result.steps[1]!.result.stdout).toContain("TOTAL 880000");

    expect(result.answer).toContain("stub");
    expect(result.usage.modelCalls).toBe(3);

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "model_call", "tool_call", "tool_result",
      "model_call", "tool_call", "tool_result",
      "model_call", "answer", "usage",
    ]);
  }, 30_000);
});
