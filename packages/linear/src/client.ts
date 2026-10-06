export class LinearError extends Error {
  constructor(message: string, public status?: number, public errors?: unknown[]) { super(message); this.name = "LinearError"; }
}

export interface IssueInput {
  title: string;
  description?: string;
  teamId?: string;
  projectId?: string;
  assigneeId?: string;
  priority?: number; // 0-4, 0=none,1=urgent,2=high,3=normal,4=low
  labels?: string[];
}

export interface LinearClientOptions {
  apiKey: string;
  /** Override for self-hosted Linear / proxies */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class LinearClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(opts: LinearClientOptions) {
    if (!opts.apiKey) throw new Error("Linear API key is required (LINEAR_API_KEY)");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl || "https://api.linear.app/graphql";
    this.fetchImpl = opts.fetch || fetch;
  }

  private async gql<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { throw new LinearError(`Invalid JSON from Linear: ${text.slice(0, 200)}`, res.status); }
    if (!res.ok || (json.errors && json.errors.length)) {
      const msg = json.errors?.map((e: any) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new LinearError(msg, res.status, json.errors);
    }
    return json.data as T;
  }

  async viewer(): Promise<{ id: string; name: string; email: string }> {
    const data = await this.gql<{ viewer: { id: string; name: string; email: string } }>(`{ viewer { id name email } }`);
    return data.viewer;
  }

  async listTeams(): Promise<Array<{ id: string; name: string; key: string }>> {
    const data = await this.gql<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(
      `{ teams { nodes { id name key } } }`
    );
    return data.teams.nodes;
  }

  async listIssues(first = 25, filter?: { teamId?: string; projectId?: string; state?: "active" | "backlog" | "completed" | "canceled" }): Promise<Array<Record<string, unknown>>> {
    const where: Record<string, unknown> = {};
    if (filter?.teamId) where.team = { id: { eq: filter.teamId } };
    if (filter?.projectId) where.project = { id: { eq: filter.projectId } };
    if (filter?.state) where.state = { name: { eq: filter.state === "active" ? "In Progress" : filter.state === "backlog" ? "Backlog" : filter.state === "completed" ? "Done" : "Canceled" } };
    const data = await this.gql<{ issues: { nodes: Array<Record<string, unknown>> } }>(
      `query($first:Int!, $filter:IssueFilter) { issues(first:$first, filter:$filter) { nodes { id identifier title description priority state { name } assignee { name } project { name } createdAt updatedAt url } } }`,
      { first, filter: Object.keys(where).length ? where : undefined }
    );
    return data.issues.nodes;
  }

  async listProjects(first = 25): Promise<Array<{ id: string; name: string; description?: string; state?: string; url: string }>> {
    const data = await this.gql<{ projects: { nodes: Array<any> } }>(
      `query($first:Int!) { projects(first:$first) { nodes { id name description state url } } }`,
      { first }
    );
    return data.projects.nodes;
  }

  async createIssue(input: IssueInput): Promise<{ id: string; identifier: string; url: string; title: string }> {
    const data = await this.gql<{ issueCreate: { success: boolean; issue: any } }>(
      `mutation($input:IssueCreateInput!) { issueCreate(input:$input) { success issue { id identifier title url } } }`,
      { input: {
        title: input.title,
        description: input.description,
        teamId: input.teamId,
        projectId: input.projectId,
        assigneeId: input.assigneeId,
        priority: input.priority ?? 0,
        labelIds: input.labels,
      } }
    );
    if (!data.issueCreate.success) throw new LinearError("Failed to create Linear issue");
    return data.issueCreate.issue;
  }
}
