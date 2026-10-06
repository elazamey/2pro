import { GitLabClient } from "./client.js";

export interface GitLabProject {
  id: number;
  path_with_namespace: string;
  name: string;
  description: string | null;
  web_url: string;
  default_branch: string;
  star_count: number;
  forks_count: number;
  open_issues_count: number;
  visibility: "private" | "internal" | "public";
  archived: boolean;
  last_activity_at: string;
  created_at: string;
  namespace: { id: number; name: string; path: string; kind: "user" | "group" };
  readme_url: string | null;
  avatar_url: string | null;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  statistics?: {
    commit_count: number;
    storage_size: number;
    repository_size: number;
  };
}

export interface GitLabBranch {
  name: string;
  default: boolean;
  web_url: string;
  merged: boolean;
  protected: boolean;
  commit: { id: string; short_id: string; title: string; author_name: string; authored_date: string };
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  web_url: string;
}

export class Projects {
  constructor(private client: GitLabClient) {}

  async list(opts: { membership?: boolean; search?: string; order_by?: "id" | "name" | "path" | "created_at" | "updated_at" | "last_activity_at" | "similarity"; sort?: "asc" | "desc"; perPage?: number } = {}): Promise<GitLabProject[]> {
    return this.client.collect<GitLabProject>("/projects", {
      perPage: opts.perPage ?? 30,
      search: { membership: opts.membership ?? true, order_by: opts.order_by ?? "last_activity_at", sort: opts.sort ?? "desc", search: opts.search },
    });
  }

  async get(projectId: string | number): Promise<GitLabProject> {
    return this.client.request<GitLabProject>(`/projects/${GitLabClient.encodeProjectId(projectId)}`);
  }

  async listBranches(projectId: string | number, opts: { perPage?: number } = {}): Promise<GitLabBranch[]> {
    return this.client.collect<GitLabBranch>(`/projects/${GitLabClient.encodeProjectId(projectId)}/repository/branches`, {
      perPage: opts.perPage ?? 50,
    });
  }

  async listCommits(projectId: string | number, opts: { ref_name?: string; perPage?: number } = {}): Promise<GitLabCommit[]> {
    return this.client.collect<GitLabCommit>(`/projects/${GitLabClient.encodeProjectId(projectId)}/repository/commits`, {
      perPage: opts.perPage ?? 20,
      search: opts.ref_name ? { ref_name: opts.ref_name } : undefined,
    });
  }
}
