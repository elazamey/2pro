import type { AIProvider, ChatOptions, ChatResult, ChatMessage, StreamingChunk, ModelInfo } from "./provider.js";
import { AIError } from "./provider.js";

const DEFAULT_MODELS: ModelInfo[] = [
  { id: "gpt-4o", provider: "openai", contextWindow: 128000, maxOutput: 16384, description: "Flagship multimodal model" },
  { id: "gpt-4o-mini", provider: "openai", contextWindow: 128000, maxOutput: 16384, description: "Fast, cheap small model" },
  { id: "gpt-4-turbo", provider: "openai", contextWindow: 128000, maxOutput: 4096 },
  { id: "gpt-3.5-turbo", provider: "openai", contextWindow: 16384, maxOutput: 4096 },
];

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  #apiKey: string;
  #baseUrl: string;
  #fetchImpl: typeof fetch;

  constructor(apiKey: string, opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.#apiKey = apiKey;
    this.#baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.#fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  models() { return DEFAULT_MODELS.slice(); }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map(m => ({ role: m.role, content: m.content, name: m.name })),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      top_p: opts.topP,
      stop: opts.stop,
      stream: false,
      ...(opts.extra ?? {}),
    };
    const res = await this.#fetchImpl(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new AIError("openai", `HTTP ${res.status}: ${t.slice(0, 300)}`, res.status);
    }
    const data = await res.json() as any;
    const choice = data.choices?.[0];
    return {
      role: "assistant",
      content: choice?.message?.content ?? "",
      model: data.model,
      finishReason: choice?.finish_reason,
      id: data.id,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async *chatStream(opts: ChatOptions): AsyncGenerator<StreamingChunk> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map(m => ({ role: m.role, content: m.content, name: m.name })),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      top_p: opts.topP,
      stop: opts.stop,
      stream: true,
      stream_options: { include_usage: true },
      ...(opts.extra ?? {}),
    };
    const res = await this.#fetchImpl(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const t = res.body ? await res.text() : "(no body)";
      throw new AIError("openai", `HTTP ${res.status}: ${t.slice(0, 300)}`, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    let model = opts.model;
    let id: string | undefined;
    let finishReason: string | undefined;
    let usage: ChatResult["usage"];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s || s.startsWith(":")) continue;
          if (!s.startsWith("data:")) continue;
          const payload = s.slice(5).trim();
          if (payload === "[DONE]") {
            yield {
              done: true,
              result: { role: "assistant", content: full, model, id, finishReason, usage },
            };
            return;
          }
          try {
            const j = JSON.parse(payload);
            if (j.model) model = j.model;
            if (j.id) id = j.id;
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) { full += delta; yield { delta, done: false }; }
            if (j.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
            if (j.usage) {
              usage = { promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens, totalTokens: j.usage.total_tokens };
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { done: true, result: { role: "assistant", content: full, model, id, finishReason, usage } };
  }
}
