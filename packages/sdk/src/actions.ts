import type { GitHubClient } from "./client.js";
import type { PaginatedOptions } from "./client.js";

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: "active" | "deleted" | "disabled_fork" | "disabled_inactivity" | "disabled_manually";
  created_at: string;
  updated_at: string;
  url: string;
  html_url: string;
  badge_url: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  node_id: string;
  head_branch: string;
  head_sha: string;
  run_number: number;
  event: string;
  status: "queued" | "in_progress" | "completed" | "requested" | "waiting" | "pending";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | "stale" | null;
  workflow_id: number;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  html_url: string;
  triggering_actor: { login: string; avatar_url: string } | null;
  repository: { full_name: string } | null;
  head_commit: {
    id: string;
    message: string;
    author: { name: string; email: string };
  } | null;
}

export interface WorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | "waiting";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  steps?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
    started_at?: string;
    completed_at?: string;
  }>;
}

export interface ListWorkflowRunsOptions extends PaginatedOptions {
  actor?: string;
  branch?: string;
  event?: string;
  status?: "queued" | "in_progress" | "completed" | "requested" | "waiting" | "pending";
  created?: string;
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required";
}

interface WorkflowListResponse { total_count: number; workflows: Workflow[] }
interface WorkflowRunListResponse { total_count: number; workflow_runs: WorkflowRun[] }
interface WorkflowJobListResponse { total_count: number; jobs: WorkflowJob[] }

export class Actions {
  constructor(private client: GitHubClient) {}

  /** List workflows. */
  async listWorkflows(owner: string, repo: string, opts: PaginatedOptions = {}): Promise<Workflow[]> {
    const results: Workflow[] = [];
    let page = opts.page ?? 1;
    const perPage = opts.perPage ?? 30;
    const maxPages = opts.maxPages ?? 10;
    for (let i = 0; i < maxPages; i++) {
      const res = await this.client.request<WorkflowListResponse>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows`,
        { search: { page, per_page: perPage } },
      );
      results.push(...res.workflows);
      if (res.workflows.length < perPage || results.length >= res.total_count) break;
      page++;
    }
    return results;
  }

  /** List workflow runs. */
  async listRuns(owner: string, repo: string, opts: ListWorkflowRunsOptions = {}): Promise<WorkflowRun[]> {
    const results: WorkflowRun[] = [];
    let page = opts.page ?? 1;
    const perPage = opts.perPage ?? 30;
    const maxPages = opts.maxPages ?? 10;
    const { page: _p, perPage: _pp, maxPages: _m, ...search } = opts;
    for (let i = 0; i < maxPages; i++) {
      const res = await this.client.request<WorkflowRunListResponse>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs`,
        { search: { ...search, page, per_page: perPage } as Record<string, string | number | boolean | undefined> },
      );
      results.push(...res.workflow_runs);
      if (res.workflow_runs.length < perPage || results.length >= res.total_count) break;
      page++;
    }
    return results;
  }

  /** Get a workflow run. */
  async getRun(owner: string, repo: string, runId: number): Promise<WorkflowRun> {
    return this.client.request<WorkflowRun>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}`,
    );
  }

  /** List jobs for a workflow run. */
  async listJobs(owner: string, repo: string, runId: number, opts: { filter?: "latest" | "all" } & PaginatedOptions = {}): Promise<WorkflowJob[]> {
    const results: WorkflowJob[] = [];
    let page = opts.page ?? 1;
    const perPage = opts.perPage ?? 30;
    const maxPages = opts.maxPages ?? 10;
    for (let i = 0; i < maxPages; i++) {
      const res = await this.client.request<WorkflowJobListResponse>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs`,
        { search: { filter: opts.filter, page, per_page: perPage } as Record<string, string | number | boolean | undefined> },
      );
      results.push(...res.jobs);
      if (res.jobs.length < perPage || results.length >= res.total_count) break;
      page++;
    }
    return results;
  }

  /** Rerun a workflow run. */
  async rerun(owner: string, repo: string, runId: number): Promise<void> {
    await this.client.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/rerun`,
      { method: "POST" },
    );
  }

  /** Cancel a workflow run. */
  async cancel(owner: string, repo: string, runId: number): Promise<void> {
    await this.client.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/cancel`,
      { method: "POST" },
    );
  }

  /** Trigger a workflow_dispatch event. */
  async dispatch(
    owner: string,
    repo: string,
    workflowId: number | string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<void> {
    await this.client.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(String(workflowId))}/dispatches`,
      { method: "POST", body: { ref, inputs } },
    );
  }

  /** Get combined build status badge URL for a branch/ref. */
  badgeUrl(owner: string, repo: string, ref = "main"): string {
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/badge.svg?branch=${encodeURIComponent(ref)}`;
  }
}
