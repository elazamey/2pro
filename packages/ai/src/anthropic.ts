import type { AIProvider, ChatOptions, ChatResult, StreamingChunk, ModelInfo, ChatMessage } from "./provider.js";
import { AIError } from "./provider.js";

const DEFAULT_MODELS: ModelInfo[] = [
  { id: "claude-sonnet-4-20250514", provider: "anthropic", contextWindow: 200000, maxOutput: 16384, description: "Balanced flagship" },
  { id: "claude-3-5-sonnet-latest", provider: "anthropic", contextWindow: 200000, maxOutput: 8192 },
  { id: "claude-3-5-haiku-latest", provider: "anthropic", contextWindow: 200000, maxOutput: 8192, description: "Fast, cheap" },
  { id: "claude-3-opus-latest", provider: "anthropic", contextWindow: 200000, maxOutput: 4096, description: "Most capable" },
];

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  #apiKey: string;
  #baseUrl: string;
  #fetchImpl: typeof fetch;

  constructor(apiKey: string, opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.#apiKey = apiKey;
    this.#baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.#fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  models() { return DEFAULT_MODELS.slice(); }

  #convertMessages(messages: ChatMessage[]): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
    let system: string | undefined;
    const out: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of messages) {
      if (m.role === "system") system = m.content;
      else out.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }
    return { system, messages: out };
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const { system, messages } = this.#convertMessages(opts.messages);
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
      system,
      temperature: opts.temperature,
      top_p: opts.topP,
      stop_sequences: opts.stop,
      stream: false,
      ...(opts.extra ?? {}),
    };
    const res = await this.#fetchImpl(`${this.#baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.#apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new AIError("anthropic", `HTTP ${res.status}: ${t.slice(0, 300)}`, res.status);
    }
    const data = await res.json() as any;
    const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return {
      role: "assistant",
      content: text,
      model: data.model,
      finishReason: data.stop_reason,
      id: data.id,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
      } : undefined,
    };
  }

  async *chatStream(opts: ChatOptions): AsyncGenerator<StreamingChunk> {
    const { system, messages } = this.#convertMessages(opts.messages);
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages, system,
      temperature: opts.temperature,
      top_p: opts.topP,
      stop_sequences: opts.stop,
      stream: true,
      ...(opts.extra ?? {}),
    };
    const res = await this.#fetchImpl(`${this.#baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.#apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const t = res.body ? await res.text() : "(no body)";
      throw new AIError("anthropic", `HTTP ${res.status}: ${t.slice(0, 300)}`, res.status);
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
          if (!s.startsWith("data:")) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const ev = JSON.parse(payload);
            if (ev.type === "message_start") { id = ev.message?.id; model = ev.message?.model ?? model; }
            else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
              full += ev.delta.text;
              yield { delta: ev.delta.text, done: false };
            } else if (ev.type === "message_delta") {
              finishReason = ev.delta?.stop_reason;
              if (ev.usage) {
                usage = { promptTokens: ev.usage.input_tokens, completionTokens: ev.usage.output_tokens, totalTokens: (ev.usage.input_tokens ?? 0) + (ev.usage.output_tokens ?? 0) };
              }
            } else if (ev.type === "message_stop") {
              yield { done: true, result: { role: "assistant", content: full, model, id, finishReason, usage } };
              return;
            }
          } catch { /* ignore */ }
        }
      }
    } finally { reader.releaseLock(); }
    yield { done: true, result: { role: "assistant", content: full, model, id, finishReason, usage } };
  }
}
