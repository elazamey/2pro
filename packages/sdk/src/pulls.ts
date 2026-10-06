import type { GitHubClient } from "./client.js";
import type { PaginatedOptions } from "./client.js";
import type { User, Issue } from "./issues.js";

export interface PullRequest extends Omit<Issue, "pull_request"> {
  number: number;
  state: "open" | "closed";
  title: string;
  body: string | null;
  user: User | null;
  merged: boolean;
  merged_at: string | null;
  merged_by: User | null;
  merge_commit_sha: string | null;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  review_comments: number;
  head: {
    label: string;
    ref: string;
    sha: string;
    repo: { full_name: string; name: string; owner: { login: string } } | null;
    user: User | null;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    repo: { full_name: string; name: string; owner: { login: string } } | null;
  };
  html_url: string;
  diff_url: string;
  patch_url: string;
  requested_reviewers?: User[];
}

export interface PullRequestReview {
  id: number;
  user: User | null;
  body: string | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submitted_at: string | null;
  commit_id: string | null;
}

export interface CreatePROptions {
  title: string;
  head: string; // branch name in current repo or "owner:branch" for cross-repo
  base: string;
  body?: string;
  draft?: boolean;
  maintainer_can_modify?: boolean;
}

export interface ListPROptions extends PaginatedOptions {
  state?: "open" | "closed" | "all";
  sort?: "created" | "updated" | "popularity" | "long-running";
  direction?: "asc" | "desc";
  head?: string;
  base?: string;
}

export interface MergePROptions {
  commit_title?: string;
  commit_message?: string;
  /** merge | squash | rebase */
  merge_method?: "merge" | "squash" | "rebase";
  sha?: string; // SHA that pull request head must match
}

export interface MergePRResult {
  sha: string;
  merged: boolean;
  message: string;
  html_url?: string;
}

export class Pulls {
  constructor(private client: GitHubClient) {}

  /** List pull requests. */
  async list(owner: string, repo: string, opts: ListPROptions = {}): Promise<PullRequest[]> {
    const { perPage, page, maxPages, ...rest } = opts;
    return this.client.collect<PullRequest>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      perPage,
      page,
      maxPages,
      search: rest as Record<string, string>,
    });
  }

  /** Get a pull request. */
  async get(owner: string, repo: string, number: number): Promise<PullRequest> {
    return this.client.request<PullRequest>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`);
  }

  /** Create a pull request. */
  async create(owner: string, repo: string, options: CreatePROptions): Promise<PullRequest> {
    return this.client.request<PullRequest>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      method: "POST",
      body: options,
    });
  }

  /** Update a pull request. */
  async update(
    owner: string,
    repo: string,
    number: number,
    options: Partial<CreatePROptions> & { state?: "open" | "closed" },
  ): Promise<PullRequest> {
    return this.client.request<PullRequest>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, {
      method: "PATCH",
      body: options,
    });
  }

  /** Merge a pull request. */
  async merge(owner: string, repo: string, number: number, options: MergePROptions = {}): Promise<MergePRResult> {
    return this.client.request<MergePRResult>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/merge`,
      { method: "PUT", body: options },
    );
  }

  /** Check mergeability status. */
  async isMerged(owner: string, repo: string, number: number): Promise<boolean> {
    try {
      await this.client.request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/merge`,
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Request reviewers. */
  async requestReviewers(owner: string, repo: string, number: number, reviewers: string[]): Promise<PullRequest> {
    return this.client.request<PullRequest>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/requested_reviewers`,
      { method: "POST", body: { reviewers } },
    );
  }

  /** List reviews. */
  async listReviews(owner: string, repo: string, number: number, opts: PaginatedOptions = {}): Promise<PullRequestReview[]> {
    return this.client.collect<PullRequestReview>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/reviews`,
      opts,
    );
  }
}
