// src/lib/ai/webllm.ts
// Local LLM runtime via @mlc-ai/web-llm (WebGPU, fully in-browser).
//
// The model is heavy (hundreds of MB) so we lazy-load on first use and
// surface progress + a graceful fallback when WebGPU isn't available.

import type {
  ChatCompletionMessageParam,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";

export interface WebLlmProgress {
  text: string;
  progress: number;
}

export interface WebLlmRuntime {
  engine: MLCEngineInterface;
  model: string;
}

// ---------------------------------------------------------------------------
// Response shapes needed by query-router.ts
// ---------------------------------------------------------------------------

export interface WebLlmResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface WebLlmChatOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  seed?: number;
}

/**
 * Router-friendly backend interface.
 * query-router.ts uses this to swap OpenAI ↔ WebLLM without changing call sites.
 */
export interface LlmBackend {
  complete: (
    messages: ChatCompletionMessageParam[],
    options?: WebLlmChatOptions
  ) => Promise<WebLlmResponse>;
}

// ---------------------------------------------------------------------------
// Engine lifecycle (your existing code, preserved)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

let _runtime: WebLlmRuntime | null = null;
let _loading: Promise<WebLlmRuntime> | null = null;

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).gpu;
}

export async function getWebLlm(
  model: string = DEFAULT_MODEL,
  onProgress?: (p: WebLlmProgress) => void
): Promise<WebLlmRuntime> {
  if (_runtime && _runtime.model === model) return _runtime;
  if (_loading) return _loading;

  if (!isWebGpuAvailable()) {
    throw new Error(
      "WebGPU is not available in this environment. Local LLM cannot start."
    );
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

/**
 * Free GPU memory. Call this when switching companies or on app shutdown.
 */
export async function disposeWebLlm(): Promise<void> {
  if (_runtime) {
    try {
      // MLC's way to unload the model from GPU
      await _runtime.engine.reload(""); 
    } catch {
      // ignore unload errors
    }
    _runtime = null;
    _loading = null;
  }
}

// ---------------------------------------------------------------------------
// Chat completion (structured response, for query-router.ts)
// ---------------------------------------------------------------------------

export async function chatCompletion(
  messages: ChatCompletionMessageParam[],
  opts?: WebLlmChatOptions & { model?: string }
): Promise<WebLlmResponse> {
  const rt = await getWebLlm(opts?.model);
  const res = await rt.engine.chat.completions.create({
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens,
    stop: opts?.stop,
    seed: opts?.seed,
    stream: false,
  });

  const choice = res.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
      totalTokens: res.usage?.total_tokens ?? 0,
    },
    finishReason: choice?.finish_reason ?? "stop",
  };
}

/**
 * Streaming variant — yields text chunks for the typing indicator.
 */
export async function* chatCompletionStream(
  messages: ChatCompletionMessageParam[],
  opts?: WebLlmChatOptions & { model?: string }
): AsyncGenerator<string, WebLlmResponse, unknown> {
  const rt = await getWebLlm(opts?.model);
  const stream = await rt.engine.chat.completions.create({
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens,
    stop: opts?.stop,
    seed: opts?.seed,
    stream: true,
    stream_options: { include_usage: true },
  });

  let content = "";
  let finishReason = "stop";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      content += delta;
      yield delta;
    }
    if (chunk.choices?.[0]?.finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
    }
  }

  return { content, usage, finishReason };
}

// ---------------------------------------------------------------------------
// Router wrapper
// ---------------------------------------------------------------------------

export function createWebLlmBackend(
  model?: string,
  onProgress?: (p: WebLlmProgress) => void
): LlmBackend {
  // Pre-warm the engine so first chat isn't slow
  getWebLlm(model, onProgress).catch(() => {
    /* preload failure is non-fatal */
  });

  return {
    complete: (messages, options) => chatCompletion(messages, { ...options, model }),
  };
}

// ---------------------------------------------------------------------------
// Legacy convenience wrapper (keep for existing call sites)
// ---------------------------------------------------------------------------

export async function webLlmChat(
  messages: ChatCompletionMessageParam[],
  opts?: { model?: string; temperature?: number }
): Promise<string> {
  const res = await chatCompletion(messages, opts);
  return res.content;
}
