/**
 * The model behind the agent, behind one small interface.
 *
 * `geminiLlm()`  — the real thing (GEMINI_API_KEY, gemini-3.6-flash).
 * `stubLlm()`    — a scripted model for tests and for building the loop
 *                  without spending a token. LLM=stub selects it.
 *
 * Everything the agent needs from a model: given the conversation so far,
 * return either tool calls to execute or a final text answer.
 */
import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
} from "@google/genai";

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

export interface LlmTurn {
  /** The model's message, to append to history verbatim (keeps Gemini's thought signatures). */
  content: Content;
  toolCalls: ToolCall[];
  text: string;
  usage: Usage;
}

export interface Llm {
  readonly name: string;
  generate(system: string, history: Content[]): Promise<LlmTurn>;
}

/** The one tool the agent has. The description is what the model reads. */
export const RUN_PYTHON: FunctionDeclaration = {
  name: "run_code",
  description:
    "Run a program in an isolated sandbox and return its stdout, stderr and " +
    "exit code. Files the user uploaded are in /workspace, which is the " +
    "working directory and the only writable place besides /tmp — save any " +
    "chart or output file there. No network. 10 second limit (compiling " +
    "counts towards it), 256 MB RAM.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      code: {
        type: Type.STRING,
        description: "The complete program, as a single file.",
      },
      language: {
        type: Type.STRING,
        description:
          "python (default; pandas and matplotlib available) | javascript " +
          "(node, standard library only) | c | cpp | java (the public class " +
          "must be named Main) | bash. Prefer python for anything involving " +
          "data or charts.",
      },
    },
    required: ["code"],
  },
};

export function pickLlm(): Llm {
  return process.env.LLM === "stub" ? stubLlm() : geminiLlm();
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

export function geminiLlm(): Llm {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (or use LLM=stub)");
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const ai = new GoogleGenAI({ apiKey });

  return {
    name: model,
    async generate(system, history) {
      const res = await withRetry(() =>
        ai.models.generateContent({
          model,
          contents: history,
          config: {
            systemInstruction: system,
            tools: [{ functionDeclarations: [RUN_PYTHON] }],
            temperature: 0.2,
          },
        }),
      );
      const content = res.candidates?.[0]?.content ?? {
        role: "model",
        parts: [{ text: res.text ?? "" }],
      };
      const u = res.usageMetadata;
      return {
        content,
        toolCalls: (res.functionCalls ?? []).map((c) => ({
          id: c.id,
          name: c.name ?? "",
          args: c.args ?? {},
        })),
        text: res.text ?? "",
        usage: {
          inputTokens: u?.promptTokenCount ?? 0,
          outputTokens: u?.candidatesTokenCount ?? 0,
          thoughtTokens: u?.thoughtsTokenCount ?? 0,
        },
      };
    },
  };
}

/**
 * A model API is a network call, and network calls fail for reasons that have
 * nothing to do with you. 503 (overloaded) and a per-minute 429 mean "try
 * again shortly"; anything else means "you're wrong" and retrying won't help.
 *
 * Not every 429 is retryable: the free tier also has a per-DAY bucket
 * (`…PerDay…` in the quota id). Retrying that just burns time, so it fails
 * fast with a message that says what to do. When Google names a delay
 * (`retryDelay`), honour it; otherwise back off 1 s, 2 s, 4 s.
 */
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 15_000;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const info = classify(err);
      if (info.kind === "daily-quota") {
        throw new Error(
          `Gemini free-tier daily quota exhausted for ${info.model ?? "this model"}. ` +
            `Quota is per model: set GEMINI_MODEL to another (e.g. gemini-3.5-flash-lite) and restart.`,
        );
      }
      if (info.kind !== "transient" || attempt === MAX_ATTEMPTS - 1) throw err;
      const delay = Math.min(info.retryMs ?? 1000 * 2 ** attempt, MAX_WAIT_MS);
      console.warn(`model returned ${info.status}; retrying in ${delay} ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

interface ErrorInfo {
  kind: "transient" | "daily-quota" | "fatal";
  status: number;
  retryMs?: number;
  model?: string;
}

/** The SDK throws an Error whose message is the API's JSON body. */
function classify(err: unknown): ErrorInfo {
  const m = (err as Error)?.message ?? "";
  const status = Number(m.match(/"code":\s*(\d{3})/)?.[1] ?? 0);
  const model = m.match(/"model":\s*"([^"]+)"/)?.[1];
  if (status === 429 && /PerDay/.test(m))
    return { kind: "daily-quota", status, model };
  if (status === 429 || status === 503) {
    const secs = m.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1];
    return {
      kind: "transient",
      status,
      retryMs: secs ? Number(secs) * 1000 : undefined,
    };
  }
  return { kind: "fatal", status };
}

// ─── Stub ────────────────────────────────────────────────────────────────────

/**
 * Plays a fixed script: a first attempt that reads a column that doesn't
 * exist, a corrected second attempt, then an answer. Enough to exercise the
 * whole loop — sandbox included — deterministically.
 */
export function stubLlm(): Llm {
  const script: Array<{ code: string } | { text: string }> = [
    {
      code:
        "import pandas as pd\n" +
        "df = pd.read_csv('/workspace/sales.csv')\n" +
        "print(df['Revenue'].sum())\n",
    },
    {
      code:
        "import pandas as pd\n" +
        "df = pd.read_csv('/workspace/sales.csv')\n" +
        "print(list(df.columns))\n" +
        "col = [c for c in df.columns if 'revenue' in c.lower()][0]\n" +
        "vals = pd.to_numeric(df[col].astype(str).str.replace(r'[^0-9.]', '', regex=True))\n" +
        "print('TOTAL', int(vals.sum()))\n",
    },
    { text: "Total revenue is ₹4,25,000 (stub)." },
  ];
  let step = 0;

  return {
    name: "stub",
    async generate() {
      const next = script[Math.min(step, script.length - 1)]!;
      step += 1;
      if ("code" in next) {
        const call: ToolCall = {
          id: `stub-${step}`,
          name: "run_code",
          args: { code: next.code, language: "python" },
        };
        return {
          content: {
            role: "model",
            parts: [
              {
                functionCall: { id: call.id, name: call.name, args: call.args },
              },
            ],
          },
          toolCalls: [call],
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 },
        };
      }
      return {
        content: { role: "model", parts: [{ text: next.text }] },
        toolCalls: [],
        text: next.text,
        usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 },
      };
    },
  };
}
