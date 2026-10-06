import type { FigmaFile, FigmaNode } from "./types.js";

export interface FigmaClientConfig {
  /** Personal access token (figd_...). */
  token?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Parse a Figma URL or file key.
 *
 * Accepts:
 *   - Plain file key:  "abc123DEF456"
 *   - Full URL:        "https://www.figma.com/file/abc123DEF456/My-Design?node-id=123%3A456"
 *   - Design link:     "https://www.figma.com/design/abc123DEF456/..."
 *
 * Returns { fileKey, nodeId } (nodeId is decoded, "123:456" form).
 */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
  const trimmed = input.trim();
  const urlMatch = /figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/.exec(trimmed);
  if (urlMatch) {
    const fileKey = urlMatch[1];
    const nodeParam = /[?&]node-id=([^&]+)/.exec(trimmed);
    let nodeId: string | undefined;
    if (nodeParam) nodeId = decodeURIComponent(nodeParam[1]).replace("-", ":");
    return { fileKey, nodeId };
  }
  // Assume it's already a key
  const keyMatch = /^([A-Za-z0-9_-]{8,})$/.exec(trimmed);
  if (keyMatch) return { fileKey: keyMatch[1] };
  throw new Error(`Could not parse Figma file key/URL: ${input}`);
}

export class FigmaClient {
  readonly #token?: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: FigmaClientConfig = {}) {
    this.#token = config.token ?? process.env.FIGMA_ACCESS_TOKEN;
    this.#baseUrl = (config.baseUrl ?? "https://api.figma.com").replace(/\/$/, "");
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(path: string, opts: RequestInit & { search?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.#baseUrl}/v1${path.startsWith("/") ? path : `/${path}`}`);
    if (opts.search) for (const [k, v] of Object.entries(opts.search)) if (v !== undefined) url.searchParams.set(k, v);
    const headers = new Headers(opts.headers);
    if (this.#token) headers.set("X-Figma-Token", this.#token);
    const res = await this.#fetch(url.toString(), { ...opts, headers });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Figma API ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  }

  /** Fetch an entire Figma file (or specific nodes if nodeIds given). */
  async getFile(fileKey: string, opts: { nodeIds?: string[]; depth?: number } = {}): Promise<FigmaFile> {
    const search: Record<string, string> = {};
    if (opts.nodeIds?.length) search.ids = opts.nodeIds.join(",");
    if (opts.depth) search.depth = String(opts.depth);
    return this.request<FigmaFile>(`/files/${fileKey}`, { search });
  }

  /** Fetch specific nodes from a file by id (decoded ids like "123:456"). */
  async getNodes(fileKey: string, nodeIds: string[]): Promise<Record<string, { document: FigmaNode }>> {
    const r = await this.request<{ nodes: Record<string, { document: FigmaNode }> }>(
      `/files/${fileKey}/nodes`,
      { search: { ids: nodeIds.join(",") } },
    );
    return r.nodes;
  }

  /** Get image URLs for node ids. Returns map of nodeId -> URL (PNG/SVG/PDF/JPG). */
  async getImages(fileKey: string, nodeIds: string[], format: "png" | "svg" | "jpg" | "pdf" = "png", scale = 1): Promise<Record<string, string>> {
    const r = await this.request<{ images: Record<string, string | null> }>(
      `/images/${fileKey}`,
      { search: { ids: nodeIds.join(","), format, scale: String(scale) } },
    );
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.images)) if (v) out[k] = v;
    return out;
  }

  /** Convenience: fetch a file and return the document plus optional targeted node. */
  async resolve(input: string): Promise<{ fileKey: string; file: FigmaFile; node?: FigmaNode }> {
    const { fileKey, nodeId } = parseFigmaUrl(input);
    if (nodeId) {
      const nodes = await this.getNodes(fileKey, [nodeId]);
      const node = nodes[nodeId]?.document;
      // Also pull whole file (shallow) so callers can access styles/components.
      const file = await this.getFile(fileKey);
      return { fileKey, file, node };
    }
    const file = await this.getFile(fileKey);
    return { fileKey, file };
  }
}
