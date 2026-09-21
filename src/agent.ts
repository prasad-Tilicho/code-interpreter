/**
 * The agent loop.
 *
 *   ask the model → it returns code → run it in the sandbox → hand the output
 *   back → repeat until the model answers in text (or we hit the step cap).
 *
 * The model never touches the machine. It only ever sees a string of stdout /
 * stderr that the sandbox chose to return. That boundary is the product.
 */
import type { Content } from "@google/genai";
import type { Llm, Usage } from "./llm.js";
import { runPython, type InputFile, type RunResult } from "./sandbox.js";

const MAX_STEPS = 8;

export const SYSTEM_PROMPT = `You are a careful data analyst with one tool: run_python.
You cannot see the user's files directly — inspect them with code first
(print columns, dtypes, a few rows) before computing anything.
If a run fails, read stderr, fix the code, and run again.
Keep scripts short; print only what you need.
When you have the answer, reply in plain text with the numbers, in one or two sentences.
Never claim a result you did not print.`;

export type AgentEvent =
  | { type: "model_call"; step: number }
  | { type: "tool_call"; step: number; code: string }
  | { type: "tool_result"; step: number; result: RunResult }
  | { type: "answer"; text: string }
  | { type: "usage"; usage: Usage & { steps: number; modelCalls: number } }
  | { type: "error"; message: string };

export interface AgentInput {
  question: string;
  files?: InputFile[];
  llm: Llm;
  onEvent?: (e: AgentEvent) => void;
}

export interface AgentResult {
  answer: string;
  steps: Array<{ code: string; result: RunResult }>;
  usage: Usage & { steps: number; modelCalls: number };
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const emit = input.onEvent ?? (() => undefined);
  const files = input.files ?? [];
  const fileList =
    files.length > 0
      ? `Files in /workspace: ${files.map((f) => f.name).join(", ")}\n\n`
      : "";

  const history: Content[] = [
    { role: "user", parts: [{ text: fileList + input.question }] },
  ];
  const steps: AgentResult["steps"] = [];
  const usage = { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 };
  let modelCalls = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    emit({ type: "model_call", step });
    const turn = await input.llm.generate(SYSTEM_PROMPT, history);
    modelCalls += 1;
    usage.inputTokens += turn.usage.inputTokens;
    usage.outputTokens += turn.usage.outputTokens;
    usage.thoughtTokens += turn.usage.thoughtTokens;
    history.push(turn.content);

    if (turn.toolCalls.length === 0) {
      const summary = { ...usage, steps: steps.length, modelCalls };
      emit({ type: "answer", text: turn.text });
      emit({ type: "usage", usage: summary });
      return { answer: turn.text, steps, usage: summary };
    }

    // Execute every call the model made this turn, reply to all of them at once.
    const responses: Content["parts"] = [];
    for (const call of turn.toolCalls) {
      const code = typeof call.args.code === "string" ? call.args.code : "";
      emit({ type: "tool_call", step, code });
      const result = await runPython(code, { files });
      steps.push({ code, result });
      emit({ type: "tool_result", step, result });
      responses.push({
        functionResponse: {
          id: call.id,
          name: call.name,
          response: toolOutput(result),
        },
      });
    }
    history.push({ role: "user", parts: responses });
  }

  const message = `Gave up after ${MAX_STEPS} steps without a final answer.`;
  emit({ type: "error", message });
  const summary = { ...usage, steps: steps.length, modelCalls };
  return { answer: message, steps, usage: summary };
}

/** What the model gets to see about a run. Nothing else leaves the sandbox. */
function toolOutput(r: RunResult): Record<string, unknown> {
  const why = r.timedOut
    ? "killed: exceeded the 10 s time limit"
    : r.oomKilled
      ? "killed: exceeded the 256 MB memory limit"
      : undefined;
  return {
    exit_code: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    ...(why ? { error: why } : {}),
    ...(r.truncated ? { note: "output truncated at 64 KB" } : {}),
    ...(r.producedFiles.length ? { files_written: r.producedFiles } : {}),
  };
}
