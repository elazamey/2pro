import type { GitHubClient } from "./client.js";
import type { PaginatedOptions } from "./client.js";

export interface Repository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  owner: { login: string; id: number; type: string; avatar_url: string };
  archived: boolean;
}

export interface Branch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface Commit {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string } | null;
    message: string;
  };
  author: { login: string; avatar_url: string } | null;
  html_url: string;
}

export interface CreateRepoOptions {
  name: string;
  description?: string;
  homepage?: string;
  private?: boolean;
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  auto_init?: boolean;
  gitignore_template?: string;
  license_template?: string;
  /** For org repos: organization name. */
  org?: string;
}

export interface ListReposOptions extends PaginatedOptions {
  sort?: "created" | "updated" | "pushed" | "full_name";
  direction?: "asc" | "desc";
  type?: "all" | "owner" | "public" | "private" | "member";
  visibility?: "all" | "public" | "private";
  affiliation?: string;
}

export interface GetContentOptions {
  ref?: string;
}

export interface ContentFile {
  type: "file" | "dir" | "symlink" | "submodule";
  encoding?: string;
  size: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
  html_url: string;
  download_url: string | null;
}

export class Repos {
  constructor(private client: GitHubClient) {}

  /** List authenticated user's repositories. */
  async list(opts: ListReposOptions = {}): Promise<Repository[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<Repository>("/user/repos", {
      perPage,
      page,
      maxPages,
      search: { ...rest },
    });
  }

  /** List repos for a user. */
  async listForUser(username: string, opts: ListReposOptions = {}): Promise<Repository[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<Repository>(`/users/${encodeURIComponent(username)}/repos`, {
      perPage,
      page,
      maxPages,
      search: { ...rest },
    });
  }

  /** List repos for an org. */
  async listForOrg(org: string, opts: ListReposOptions & { type?: string } = {}): Promise<Repository[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<Repository>(`/orgs/${encodeURIComponent(org)}/repos`, {
      perPage,
      page,
      maxPages,
      search: { ...rest },
    });
  }

  /** Get a single repository. */
  async get(owner: string, repo: string): Promise<Repository> {
    return this.client.request<Repository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  }

  /** Create a new repository (user account or org). */
  async create(options: CreateRepoOptions): Promise<Repository> {
    const { org, ...body } = options;
    if (org) {
      return this.client.request<Repository>(`/orgs/${encodeURIComponent(org)}/repos`, {
        method: "POST",
        body,
      });
    }
    return this.client.request<Repository>("/user/repos", { method: "POST", body });
  }

  /** Delete a repository. */
  async delete(owner: string, repo: string): Promise<void> {
    await this.client.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { method: "DELETE" });
  }

  /** List branches. */
  async listBranches(owner: string, repo: string, opts: PaginatedOptions = {}): Promise<Branch[]> {
    return this.client.collect<Branch>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, opts);
  }

  /** List commits. */
  async listCommits(owner: string, repo: string, opts: PaginatedOptions & { sha?: string; since?: string; until?: string } = {}): Promise<Commit[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<Commit>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`, {
      perPage,
      page,
      maxPages,
      search: rest as Record<string, string>,
    });
  }

  /** Get file/dir contents. */
  async getContent(owner: string, repo: string, path: string, opts: GetContentOptions = {}): Promise<ContentFile | ContentFile[]> {
    return this.client.request<ContentFile | ContentFile[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\//, "")}`,
      { search: opts.ref ? { ref: opts.ref } : undefined },
    );
  }

  /** Create or update a file via the Contents API. */
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: { message: string; content: string; sha?: string; branch?: string },
  ): Promise<{ commit: { sha: string; html_url: string } }> {
    const body = {
      message: content.message,
      content: Buffer.from(content.content).toString("base64"),
      sha: content.sha,
      branch: content.branch,
    };
    return this.client.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.replace(/^\//, "")}`, {
      method: "PUT",
      body,
    });
  }
}
