/// <reference lib="dom" />

export interface GitHubClientConfig {
  /** Personal access token or GitHub App token. */
  token?: string;
  /** Override base URL for GitHub Enterprise Server. Defaults to https://api.github.com. */
  baseUrl?: string;
  /** User agent header. */
  userAgent?: string;
  /** Pre-configured fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw search / query params. */
  search?: Record<string, string | number | boolean | undefined>;
}

export interface PaginatedOptions {
  perPage?: number;
  page?: number;
  /** Auto-follow Link: rel="next" pages up to this many total pages. */
  maxPages?: number;
}

export interface GitHubErrorData {
  message: string;
  documentation_url?: string;
  errors?: Array<{ resource: string; code: string; field?: string; message?: string }>;
  status: number;
}

export class GitHubError extends Error {
  readonly status: number;
  readonly data: GitHubErrorData;

  constructor(data: GitHubErrorData) {
    super(data.message);
    this.name = "GitHubError";
    this.status = data.status;
    this.data = data;
  }
}

export class GitHubClient {
  readonly #token?: string;
  readonly #baseUrl: string;
  readonly #userAgent: string;
  readonly #fetch: typeof fetch;

  constructor(config: GitHubClientConfig = {}) {
    this.#token = config.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    this.#baseUrl = (config.baseUrl ?? process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
    this.#userAgent = config.userAgent ?? "2pro-sdk/1.0";
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  get token(): string | undefined {
    return this.#token;
  }

  /** Raw request helper. Returns parsed JSON. */
  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.#baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (opts.search) {
      for (const [k, v] of Object.entries(opts.search)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": this.#userAgent,
      ...(opts.headers ?? {}),
    };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;

    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await this.#fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers,
      body,
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T | GitHubErrorData) : null;

    if (!res.ok) {
      throw new GitHubError({
        message: (data as GitHubErrorData)?.message ?? `GitHub request failed: ${res.status} ${res.statusText}`,
        documentation_url: (data as GitHubErrorData)?.documentation_url,
        errors: (data as GitHubErrorData)?.errors,
        status: res.status,
      });
    }
    return data as T;
  }

  /** Execute a paginated GET, following Link: rel="next" headers. */
  async *paginate<T>(path: string, opts: PaginatedOptions & Omit<RequestOptions, "method"> = {}): AsyncGenerator<T[], void> {
    const perPage = opts.perPage ?? 30;
    let page = opts.page ?? 1;
    const maxPages = opts.maxPages ?? 10;

    for (let i = 0; i < maxPages; i++) {
      const url = new URL(path.startsWith("http") ? path : `${this.#baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
      if (opts.search) for (const [k, v] of Object.entries(opts.search)) if (v !== undefined) url.searchParams.set(k, String(v));
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));

      const res = await this.#fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": this.#userAgent,
          ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
      });
      const text = await res.text();
      if (!res.ok) {
        const data = text ? JSON.parse(text) : {};
        throw new GitHubError({ status: res.status, ...data });
      }
      const items = text ? (JSON.parse(text) as T[]) : [];
      yield items;
      if (items.length < perPage) return;

      const link = res.headers.get("link") ?? "";
      const nextMatch = /<([^>]+)>;\s*rel="next"/.exec(link);
      if (!nextMatch) return;
      path = nextMatch[1]; // absolute URL for next page
      page++; // (path overrides, but keep for safety)
    }
  }

  /** Collect paginated results into a single array. */
  async collect<T>(path: string, opts: PaginatedOptions & Omit<RequestOptions, "method"> = {}): Promise<T[]> {
    const out: T[] = [];
    for await (const page of this.paginate<T>(path, opts)) out.push(...page);
    return out;
  }

  /** Execute a GraphQL query. */
  async graphql<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>("/graphql", { method: "POST", body: { query, variables } });
  }
}
