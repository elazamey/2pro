import { GitLabClient } from "./client.js";

export type IssueState = "opened" | "closed" | "all";

export interface GitLabLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatar_url: string | null;
  web_url: string;
  state: string;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
  web_url: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  labels: string[];
  upvotes: number;
  downvotes: number;
  user_notes_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  due_date: string | null;
  confidential: boolean;
  milestone: { id: number; title: string } | null;
  has_tasks?: boolean;
  task_status?: string;
}

export interface CreateIssueOptions {
  title: string;
  description?: string;
  assignee_ids?: number[];
  labels?: string; // comma-separated
  milestone_id?: number;
  due_date?: string;
  confidential?: boolean;
}

export class Issues {
  constructor(private client: GitLabClient) {}

  async list(projectId: string | number, opts: { state?: IssueState; labels?: string; search?: string; perPage?: number } = {}): Promise<GitLabIssue[]> {
    return this.client.collect<GitLabIssue>(`/projects/${GitLabClient.encodeProjectId(projectId)}/issues`, {
      perPage: opts.perPage ?? 30,
      search: { state: opts.state ?? "opened", labels: opts.labels, search: opts.search },
    });
  }

  async get(projectId: string | number, issueIid: number): Promise<GitLabIssue> {
    return this.client.request<GitLabIssue>(`/projects/${GitLabClient.encodeProjectId(projectId)}/issues/${issueIid}`);
  }

  async create(projectId: string | number, opts: CreateIssueOptions): Promise<GitLabIssue> {
    return this.client.request<GitLabIssue>(`/projects/${GitLabClient.encodeProjectId(projectId)}/issues`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  }

  async close(projectId: string | number, issueIid: number): Promise<GitLabIssue> {
    return this.client.request<GitLabIssue>(`/projects/${GitLabClient.encodeProjectId(projectId)}/issues/${issueIid}`, {
      method: "PUT",
      body: JSON.stringify({ state_event: "close" }),
    });
  }

  async reopen(projectId: string | number, issueIid: number): Promise<GitLabIssue> {
    return this.client.request<GitLabIssue>(`/projects/${GitLabClient.encodeProjectId(projectId)}/issues/${issueIid}`, {
      method: "PUT",
      body: JSON.stringify({ state_event: "reopen" }),
    });
  }

  async addNote(projectId: string | number, issueIid: number, body: string): Promise<{ id: number; body: string }> {
    return this.client.request(`/projects/${GitLabClient.encodeProjectId(projectId)}/issues/${issueIid}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }
}
