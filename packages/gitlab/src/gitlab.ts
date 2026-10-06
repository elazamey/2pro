import { GitLabClient } from "./client.js";
import { Projects } from "./projects.js";
import { Issues } from "./issues.js";
import { MergeRequests } from "./merge_requests.js";
import { Pipelines } from "./pipelines.js";
import type { GitLabClientConfig } from "./client.js";

export class GitLab extends GitLabClient {
  readonly projects: Projects;
  readonly issues: Issues;
  readonly mergeRequests: MergeRequests;
  readonly pipelines: Pipelines;

  constructor(config: GitLabClientConfig) {
    super(config);
    this.projects = new Projects(this);
    this.issues = new Issues(this);
    this.mergeRequests = new MergeRequests(this);
    this.pipelines = new Pipelines(this);
  }
}
