import type { AIProvider, ChatMessage, ChatOptions, ChatResult, StreamingChunk, ModelInfo } from "./provider.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export interface AIGatewayConfig {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openaiBaseUrl?: string; // e.g. for proxies or OpenAI-compatible (Together, Groq, Ollama-OpenAI)
  anthropicBaseUrl?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "gpt-4o-mini";

export class AIGateway {
  readonly #providers = new Map<string, AIProvider>();

  constructor(config: AIGatewayConfig = {}) {
    if (config.openaiApiKey) {
      this.#providers.set("openai", new OpenAIProvider(config.openaiApiKey, {
        baseUrl: config.openaiBaseUrl, fetchImpl: config.fetchImpl,
      }));
    }
    if (config.anthropicApiKey) {
      this.#providers.set("anthropic", new AnthropicProvider(config.anthropicApiKey, {
        baseUrl: config.anthropicBaseUrl, fetchImpl: config.fetchImpl,
      }));
    }
  }

  /** Return a list of all available models across all configured providers. */
  listModels(): Array<ModelInfo & { providerId: string }> {
    const out: Array<ModelInfo & { providerId: string }> = [];
    for (const [id, p] of this.#providers) for (const m of p.models()) out.push({ ...m, providerId: id });
    return out;
  }

  provider(name: string): AIProvider {
    const p = this.#providers.get(name);
    if (!p) throw new Error(`AI provider '${name}' is not configured.`);
    return p;
  }

  /** Pick a provider from a model string of the form "provider/model" or just "model" (auto-detect). */
  #resolve(model: string): { provider: AIProvider; modelId: string } {
    if (model.includes("/")) {
      const [prov, ...rest] = model.split("/");
      const p = this.#providers.get(prov);
      if (!p) throw new Error(`Unknown provider prefix '${prov}'`);
      return { provider: p, modelId: rest.join("/") };
    }
    for (const p of this.#providers.values()) {
      if (p.models().some(m => m.id === model)) return { provider: p, modelId: model };
    }
    // Fallback: openai (most permissive model naming)
    const openai = this.#providers.get("openai");
    if (openai) return { provider: openai, modelId: model };
    throw new Error(`No provider configured that supports model '${model}'`);
  }

  async chat(opts: Omit<ChatOptions, "model"> & { model?: string }): Promise<ChatResult> {
    const model = opts.model ?? DEFAULT_MODEL;
    const { provider, modelId } = this.#resolve(model);
    return provider.chat({ ...opts, model: modelId });
  }

  async *chatStream(opts: Omit<ChatOptions, "model"> & { model?: string }): AsyncGenerator<StreamingChunk> {
    const model = opts.model ?? DEFAULT_MODEL;
    const { provider, modelId } = this.#resolve(model);
    if (!provider.chatStream) {
      // Fall back to non-streaming
      const r = await provider.chat({ ...opts, model: modelId });
      yield { delta: r.content, done: false };
      yield { done: true, result: r };
      return;
    }
    yield* provider.chatStream({ ...opts, model: modelId, stream: true });
  }

  // -------- High-level helpers --------

  /** Generate a PR description from a diff + title. */
  async generatePRDescription(input: { title: string; diff: string; commits?: string[]; model?: string }): Promise<string> {
    const commitsStr = input.commits?.length ? `\n\nCommits:\n${input.commits.join("\n")}` : "";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "You write clear, concise GitHub pull request descriptions. Use markdown. Include a Summary, Key Changes (bulleted), Testing, and Breaking changes sections where relevant. Don't repeat the title verbatim. Do not use filler phrases like 'this PR' more than necessary. Output only the markdown body, no fenced code wrapping.",
      },
      {
        role: "user",
        content: `Title: ${input.title}\n\nDiff:\n\`\`\`diff\n${input.diff.slice(0, 12000)}\n\`\`\`${commitsStr}`,
      },
    ];
    const r = await this.chat({ messages, model: input.model, temperature: 0.2 });
    return r.content.trim();
  }

  /** Summarize an email thread into a short plain-text digest. */
  async summarizeEmail(input: { from: string; subject: string; body: string; model?: string }): Promise<{ summary: string; actionItems: string[] }> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "Summarize the following email in 2-3 sentences. Then list any action items as bulleted lines prefixed with '- '. Respond in plain text, not JSON.",
      },
      { role: "user", content: `From: ${input.from}\nSubject: ${input.subject}\n\n${input.body.slice(0, 12000)}` },
    ];
    const r = await this.chat({ messages, model: input.model, temperature: 0.1 });
    return parseSummaryAndActions(r.content);
  }

  /** Suggest Figma-to-code improvements. */
  async figmaCodeReview(input: { html: string; model?: string }): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: "You review generated HTML/Tailwind UI code. Suggest up to 5 concrete improvements for accessibility, semantics, responsiveness, and visual fidelity. Be brief." },
      { role: "user", content: input.html.slice(0, 12000) },
    ];
    const r = await this.chat({ messages, model: input.model, temperature: 0.2 });
    return r.content.trim();
  }
}

export function parseSummaryAndActions(text: string): { summary: string; actionItems: string[] } {
  const lines = text.split(/\r?\n/);
  const summaryLines: string[] = [];
  const actionItems: string[] = [];
  let inActions = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(-|\*|\d+\.)\s+/.test(line)) {
      inActions = true;
      actionItems.push(line.replace(/^(-|\*|\d+\.)\s+/, "").trim());
    } else if (!inActions) {
      summaryLines.push(line);
    } else {
      actionItems.push(line);
    }
  }
  return { summary: summaryLines.join(" "), actionItems };
}
