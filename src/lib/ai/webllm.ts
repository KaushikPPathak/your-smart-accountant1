// src/lib/ai/webllm.ts
// Local LLM is DISABLED — the app uses cloud LLM + local retrievers instead.
// This stub exists only so imports don't break. No npm install needed.

export interface ChatCompletionMessageParam {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface WebLlmProgress {
  text: string;
  progress: number;
}

export interface WebLlmResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
}

export interface WebLlmChatOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  seed?: number;
}

export interface LlmBackend {
  complete: (
    messages: ChatCompletionMessageParam[],
    options?: WebLlmChatOptions
  ) => Promise<WebLlmResponse>;
}

/** Always false — local LLM is not bundled. */
export function isWebGpuAvailable(): boolean {
  return false;
}

/** Always false — local LLM is not bundled. */
export async function isLocalLlmAvailable(): Promise<boolean> {
  return false;
}

export async function getWebLlm(): Promise<never> {
  throw new Error("Local LLM is not enabled. The app uses cloud LLM.");
}

export async function disposeWebLlm(): Promise<void> {
  // nothing
}

export async function chatCompletion(): Promise<never> {
  throw new Error("Local LLM is not enabled. The app uses cloud LLM.");
}

export async function* chatCompletionStream(): AsyncGenerator<string, WebLlmResponse, unknown> {
  throw new Error("Local LLM is not enabled. The app uses cloud LLM.");
  // eslint-disable-next-line no-unreachable
  return { content: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
}

export function createWebLlmBackend(): LlmBackend {
  return {
    complete: () => chatCompletion(),
  };
}

export async function webLlmChat(): Promise<never> {
  throw new Error("Local LLM is not enabled. The app uses cloud LLM.");
}
