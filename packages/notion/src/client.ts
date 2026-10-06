export class NotionError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) { super(message); this.name = "NotionError"; }
}

export interface NotionClientOptions {
  token: string;
  /** Notion-Version header */
  version?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class NotionClient {
  private token: string;
  private version: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(opts: NotionClientOptions) {
    if (!opts.token) throw new Error("Notion integration token is required (NOTION_TOKEN)");
    this.token = opts.token.startsWith("Bearer ") || opts.token.startsWith("secret_") ? opts.token : `Bearer ${opts.token}`;
    if (!this.token.startsWith("Bearer ")) this.token = `Bearer ${opts.token}`;
    this.version = opts.version || "2022-06-28";
    this.baseUrl = opts.baseUrl || "https://api.notion.com/v1";
    this.fetchImpl = opts.fetch || fetch;
  }

  private async req<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Authorization": this.token,
        "Notion-Version": this.version,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { throw new NotionError(`Invalid JSON: ${text.slice(0, 200)}`, res.status); }
    if (!res.ok) throw new NotionError(json.message || `HTTP ${res.status}`, res.status, json);
    return json as T;
  }

  /** List databases the integration has access to. */
  async searchDatabases(query?: string, pageSize = 25): Promise<Array<Record<string, unknown>>> {
    const data = await this.req<any>("/search", {
      method: "POST",
      body: JSON.stringify({ query, filter: { value: "database", property: "object" }, page_size: pageSize }),
    });
    return data.results;
  }

  /** Query a database for its pages (rows). */
  async queryDatabase(databaseId: string, pageSize = 25): Promise<Array<Record<string, unknown>>> {
    const data = await this.req<any>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: pageSize }),
    });
    return data.results;
  }

  /** Retrieve a database schema. */
  async getDatabase(databaseId: string): Promise<Record<string, unknown>> {
    return this.req<any>(`/databases/${databaseId}`);
  }

  /** Retrieve a page (record). */
  async getPage(pageId: string): Promise<Record<string, unknown>> {
    return this.req<any>(`/pages/${pageId}`);
  }

  /** Retrieve children blocks (content) of a page or block. */
  async listBlocks(blockId: string, pageSize = 50): Promise<Array<Record<string, unknown>>> {
    const data = await this.req<any>(`/blocks/${blockId}/children?page_size=${pageSize}`);
    return data.results;
  }

  /** Append text children blocks to a page. */
  async appendText(pageId: string, text: string): Promise<void> {
    await this.req(`/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } }] }),
    });
  }
}
