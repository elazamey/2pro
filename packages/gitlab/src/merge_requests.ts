import { GitLabClient } from "./client.js";
import type { GitLabUser } from "./issues.js";

export type MRState = "opened" | "closed" | "locked" | "merged";
export type MRScope = "created-by-me" | "assigned-to-me" | "all";

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: MRState;
  merged_at: string | null;
  closed_at: string | null;
  web_url: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  reviewers: GitLabUser[];
  source_branch: string;
  target_branch: string;
  sha: string;
  merge_status: "can_be_merged" | "cannot_be_merged" | "unchecked" | "checking" | "cannot_be_merged_recheck";
  work_in_progress: boolean;
  draft: boolean;
  upvotes: number;
  downvotes: number;
  user_notes_count: number;
  labels: string[];
  has_conflicts: boolean;
  changes_count: string | null;
  additions?: number;
  deletions?: number;
  total_changes_count?: number;
  squash: boolean;
  merged_by: GitLabUser | null;
  created_at: string;
  updated_at: string;
  milestone: { id: number; title: string } | null;
  references: { short: string; relative: string; full: string };
  diverged_commits_count?: number;
  user: { can_merge: boolean };
  pipeline?: {
    id: number;
    status: "running" | "pending" | "success" | "failed" | "canceled" | "skipped";
    ref: string;
    sha: string;
  };
  head_pipeline?: {
    id: number;
    status: string;
    sha: string;
    web_url: string;
  };
  diff_refs?: { base_sha: string; head_sha: string; start_sha: string };
}

export interface CreateMROptions {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  labels?: string;
  assignee_id?: number;
  reviewer_ids?: number[];
  remove_source_branch?: boolean;
  squash?: boolean;
  draft?: boolean;
}

export class MergeRequests {
  constructor(private client: GitLabClient) {}

  async list(projectId: string | number, opts: { state?: MRState; scope?: MRScope; sourceBranch?: string; targetBranch?: string; perPage?: number } = {}): Promise<GitLabMergeRequest[]> {
    return this.client.collect<GitLabMergeRequest>(`/projects/${GitLabClient.encodeProjectId(projectId)}/merge_requests`, {
      perPage: opts.perPage ?? 30,
      search: {
        state: opts.state ?? "opened",
        scope: opts.scope,
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
      },
    });
  }

  async get(projectId: string | number, mrIid: number, opts: { includeDiffs?: boolean } = {}): Promise<GitLabMergeRequest> {
    return this.client.request<GitLabMergeRequest>(`/projects/${GitLabClient.encodeProjectId(projectId)}/merge_requests/${mrIid}`, {
      search: { include_diverged_commits_count: true, render_html: false },
    });
  }

  async create(projectId: string | number, opts: CreateMROptions): Promise<GitLabMergeRequest> {
    return this.client.request<GitLabMergeRequest>(`/projects/${GitLabClient.encodeProjectId(projectId)}/merge_requests`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  }

  async merge(projectId: string | number, mrIid: number, opts: { squash?: boolean; merge_commit_message?: string; squash_commit_message?: string; should_remove_source_branch?: boolean } = {}): Promise<GitLabMergeRequest> {
    return this.client.request<GitLabMergeRequest>(`/projects/${GitLabClient.encodeProjectId(projectId)}/merge_requests/${mrIid}/merge`, {
      method: "PUT",
      body: JSON.stringify(opts),
    });
  }

  async close(projectId: string | number, mrIid: number): Promise<GitLabMergeRequest> {
    return this.client.request<GitLabMergeRequest>(`/projects/${GitLabClient.encodeProjectId(projectId)}/merge_requests/${mrIid}`, {
      method: "PUT",
      body: JSON.stringify({ state_event: "close" }),
    });
  }

  async listApprovals(projectId: string | number, mrIid: number): Promise<{ approved: boolean; approved_by: Array<{ user: GitLabUser }>; approvals_required: number; approvals_left: number }> {
    return this.client.request(`/projects/${GitLabClient.encodeProjectId(projectId)}/merge_requests/${mrIid}/approvals`);
  }
}
