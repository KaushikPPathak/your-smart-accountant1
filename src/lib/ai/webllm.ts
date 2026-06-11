// Local LLM runtime via @mlc-ai/web-llm (WebGPU, fully in-browser).
//
// The model is heavy (hundreds of MB) so we lazy-load on first use and
// surface progress + a graceful fallback when WebGPU isn't available.

import type { ChatCompletionMessageParam, MLCEngineInterface } from "@mlc-ai/web-llm";

export interface WebLlmProgress {
  text: string;
  progress: number;
}

export interface WebLlmRuntime {
  engine: MLCEngineInterface;
  model: string;
}

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

let _runtime: WebLlmRuntime | null = null;
let _loading: Promise<WebLlmRuntime> | null = null;

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).gpu;
}

export async function getWebLlm(
  model: string = DEFAULT_MODEL,
  onProgress?: (p: WebLlmProgress) => void,
): Promise<WebLlmRuntime> {
  if (_runtime && _runtime.model === model) return _runtime;
  if (_loading) return _loading;

  if (!isWebGpuAvailable()) {
    throw new Error("WebGPU is not available in this environment. Local LLM cannot start.");
  }

  _loading = (async () => {
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    const engine = await CreateMLCEngine(model, {
      initProgressCallback: (r: { text: string; progress: number }) =>
        onProgress?.({ text: r.text, progress: r.progress }),
    });
    _runtime = { engine, model };
    return _runtime;
  })();

  try {
    return await _loading;
  } finally {
    _loading = null;
  }
}

export async function webLlmChat(
  messages: ChatCompletionMessageParam[],
  opts?: { model?: string; temperature?: number },
): Promise<string> {
  const rt = await getWebLlm(opts?.model);
  const res = await rt.engine.chat.completions.create({
    messages,
    temperature: opts?.temperature ?? 0.3,
    stream: false,
  });
  return res.choices?.[0]?.message?.content ?? "";
}
