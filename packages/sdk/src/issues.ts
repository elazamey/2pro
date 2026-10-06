import type { GitHubClient } from "./client.js";
import type { PaginatedOptions } from "./client.js";

export interface IssueLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface User {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  type: string;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  state_reason?: "completed" | "reopened" | "not_planned" | null;
  locked: boolean;
  body: string | null;
  user: User | null;
  labels: IssueLabel[];
  assignees: User[] | null;
  comments: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: { url: string; html_url: string };
  repository_url?: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user: User | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueOptions {
  title: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
  milestone?: number;
}

export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened";
  milestone?: number | null;
}

export interface ListIssuesOptions extends PaginatedOptions {
  state?: "open" | "closed" | "all";
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  labels?: string; // comma-separated
  since?: string; // ISO timestamp
  assignee?: string;
  creator?: string;
  mentioned?: string;
  /** For /user/issues: filter scope to assigned/created/mentioned etc. */
  filter?: string;
}

export class Issues {
  constructor(private client: GitHubClient) {}

  /** List issues in a repo. */
  async list(owner: string, repo: string, opts: ListIssuesOptions = {}): Promise<Issue[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      perPage,
      page,
      maxPages,
      search: rest as Record<string, string>,
    });
  }

  /** List all issues across repos for the authenticated user. */
  async listAll(opts: ListIssuesOptions = {}): Promise<Issue[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<Issue>("/issues", {
      perPage,
      page,
      maxPages,
      search: rest as Record<string, string>,
    });
  }

  /** Get a single issue. */
  async get(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    return this.client.request<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`);
  }

  /** Create an issue. */
  async create(owner: string, repo: string, options: CreateIssueOptions): Promise<Issue> {
    return this.client.request<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: "POST",
      body: options,
    });
  }

  /** Update an issue. */
  async update(owner: string, repo: string, issueNumber: number, options: UpdateIssueOptions): Promise<Issue> {
    return this.client.request<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`, {
      method: "PATCH",
      body: options,
    });
  }

  /** Close an issue (convenience). */
  async close(owner: string, repo: string, issueNumber: number, reason: "completed" | "not_planned" = "completed"): Promise<Issue> {
    return this.update(owner, repo, issueNumber, { state: "closed", state_reason: reason });
  }

  /** Reopen an issue. */
  async reopen(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    return this.update(owner, repo, issueNumber, { state: "open", state_reason: "reopened" });
  }

  /** Add a comment. */
  async addComment(owner: string, repo: string, issueNumber: number, body: string): Promise<IssueComment> {
    return this.client.request<IssueComment>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  /** List comments. */
  async listComments(owner: string, repo: string, issueNumber: number, opts: PaginatedOptions = {}): Promise<IssueComment[]> {
    return this.client.collect<IssueComment>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
      opts,
    );
  }
}
