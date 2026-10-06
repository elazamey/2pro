/**
 * Unified chat-model interface. Each provider translates to its own REST API.
 * The goal is a simple dependency-free client (we use global fetch).
 */

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Stop sequences */
  stop?: string[];
  /** Provider-specific overrides */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  /** If true, stream tokens via Server-Sent Events / NDJSON */
  stream?: boolean;
}

export interface ChatResult {
  role: "assistant";
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string;
  id?: string;
}

export interface StreamingChunk {
  /** Partial content delta (append to current assistant message) */
  delta?: string;
  /** True when the stream is done */
  done: boolean;
  /** Only set on the final chunk */
  result?: ChatResult;
}

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  description?: string;
}

export interface AIProvider {
  readonly name: string;
  /** Return the models this provider supports (a curated subset shipped with the SDK). */
  models(): ModelInfo[];
  chat(opts: ChatOptions): Promise<ChatResult>;
  /** Stream an async iterator of chunks. */
  chatStream?(opts: ChatOptions): AsyncGenerator<StreamingChunk>;
}

export class AIError extends Error {
  readonly status?: number;
  readonly provider: string;
  constructor(provider: string, message: string, status?: number) {
    super(`[${provider}] ${message}`);
    this.name = "AIError";
    this.provider = provider;
    this.status = status;
  }
}
