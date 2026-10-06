export interface GitLabClientConfig {
  token: string;
  /** Defaults to https://gitlab.com/api/v4. Override for self-hosted instances. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface PaginatedOptions {
  perPage?: number;
  maxPages?: number;
  page?: number;
  search?: Record<string, string | number | boolean | string[] | undefined>;
}

export class GitLabError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`GitLab API ${status}: ${message}`);
    this.name = "GitLabError";
    this.status = status;
  }
}

export class GitLabClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: GitLabClientConfig) {
    this.#token = config.token;
    this.#baseUrl = (config.baseUrl ?? process.env.GITLAB_API_URL ?? "https://gitlab.com/api/v4").replace(/\/$/, "");
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  get baseUrl() { return this.#baseUrl; }
  get token() { return this.#token; }

  async request<T = unknown>(path: string, opts: RequestInit & { search?: Record<string, string | number | boolean | string[] | undefined> } = {}): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.#baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (opts.search) for (const [k, v] of Object.entries(opts.search)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) { for (const item of v) url.searchParams.append(k, String(item)); }
      else url.searchParams.set(k, String(v));
    }
    const headers = new Headers(opts.headers);
    headers.set("PRIVATE-TOKEN", this.#token);
    if (!headers.has("Content-Type") && opts.body && opts.method !== "GET") {
      headers.set("Content-Type", "application/json");
    }
    const res = await this.#fetch(url.toString(), { ...opts, headers });
    const text = await res.text();
    if (!res.ok) throw new GitLabError(res.status, text.slice(0, 500));
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  }

  /** Paginated collection: follows the x-next-page header (GitLab style). */
  async *paginate<T>(path: string, opts: PaginatedOptions = {}): AsyncGenerator<T[], void> {
    const perPage = opts.perPage ?? 30;
    let page = opts.page ?? 1;
    const maxPages = opts.maxPages ?? 10;
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(path.startsWith("http") ? path : `${this.#baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
      if (opts.search) for (const [k, v] of Object.entries(opts.search)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) { for (const item of v) url.searchParams.append(k, String(item)); }
        else url.searchParams.set(k, String(v));
      }
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      const res = await this.#fetch(url.toString(), { headers: { "PRIVATE-TOKEN": this.#token } });
      if (!res.ok) throw new GitLabError(res.status, await res.text());
      const items = (await res.json()) as T[];
      yield items;
      if (items.length < perPage) return;
      const next = res.headers.get("x-next-page");
      if (!next) return;
      page = Number(next);
    }
  }

  async collect<T>(path: string, opts: PaginatedOptions = {}): Promise<T[]> {
    const out: T[] = [];
    for await (const page of this.paginate<T>(path, opts)) out.push(...page);
    return out;
  }

  // URL-encode a project path (namespace%2Fproject)
  static encodeProjectId(id: string | number): string {
    return encodeURIComponent(String(id));
  }
}
