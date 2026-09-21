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
  name: "run_python",
  description:
    "Run a Python 3.12 script in an isolated sandbox and return its stdout, " +
    "stderr and exit code. pandas and matplotlib are installed. Files the " +
    "user uploaded are in /workspace (the working directory). Save any chart " +
    "or output file into /workspace. No network. 10 second limit, 256 MB RAM.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      code: { type: Type.STRING, description: "The complete Python script." },
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
      const res = await ai.models.generateContent({
        model,
        contents: history,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: [RUN_PYTHON] }],
          temperature: 0.2,
        },
      });
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
          name: "run_python",
          args: { code: next.code },
        };
        return {
          content: {
            role: "model",
            parts: [{ functionCall: { id: call.id, name: call.name, args: call.args } }],
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
