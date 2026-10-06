import { GitLabClient } from "./client.js";

export type PipelineStatus = "running" | "pending" | "success" | "failed" | "canceled" | "skipped" | "created" | "manual" | "scheduled" | "preparing" | "waiting_for_resource";

export interface GitLabPipeline {
  id: number;
  iid: number;
  project_id: number;
  sha: string;
  ref: string;
  status: PipelineStatus;
  source: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  name: string | null;
  user: { id: number; name: string; username: string; avatar_url: string | null };
}

export interface GitLabJob {
  id: number;
  name: string;
  status: PipelineStatus;
  stage: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number | null;
  web_url: string;
  artifacts_file?: { filename: string; size: number };
  failure_reason?: string | null;
}

export class Pipelines {
  constructor(private client: GitLabClient) {}

  async list(projectId: string | number, opts: { ref?: string; status?: PipelineStatus; perPage?: number } = {}): Promise<GitLabPipeline[]> {
    return this.client.collect<GitLabPipeline>(`/projects/${GitLabClient.encodeProjectId(projectId)}/pipelines`, {
      perPage: opts.perPage ?? 25,
      search: { ref: opts.ref, status: opts.status, order_by: "updated_at", sort: "desc" },
    });
  }

  async get(projectId: string | number, pipelineId: number): Promise<GitLabPipeline> {
    return this.client.request<GitLabPipeline>(`/projects/${GitLabClient.encodeProjectId(projectId)}/pipelines/${pipelineId}`);
  }

  async listJobs(projectId: string | number, pipelineId: number, opts: { scope?: PipelineStatus[] } = {}): Promise<GitLabJob[]> {
    return this.client.collect<GitLabJob>(`/projects/${GitLabClient.encodeProjectId(projectId)}/pipelines/${pipelineId}/jobs`, {
      perPage: 100,
      search: opts.scope?.length ? { "scope[]": opts.scope } : undefined,
    });
  }

  async retry(projectId: string | number, pipelineId: number): Promise<GitLabPipeline> {
    return this.client.request<GitLabPipeline>(`/projects/${GitLabClient.encodeProjectId(projectId)}/pipelines/${pipelineId}/retry`, {
      method: "POST",
    });
  }

  async cancel(projectId: string | number, pipelineId: number): Promise<GitLabPipeline> {
    return this.client.request<GitLabPipeline>(`/projects/${GitLabClient.encodeProjectId(projectId)}/pipelines/${pipelineId}/cancel`, {
      method: "POST",
    });
  }

  async playJob(projectId: string | number, jobId: number): Promise<GitLabJob> {
    return this.client.request<GitLabJob>(`/projects/${GitLabClient.encodeProjectId(projectId)}/jobs/${jobId}/play`, { method: "POST" });
  }
}
