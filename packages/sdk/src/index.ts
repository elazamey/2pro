/**
 * @2pro/sdk - A TypeScript wrapper for the GitHub REST + GraphQL API.
 */

export type {
  GitHubClientConfig,
  RequestOptions,
  PaginatedOptions,
  GitHubErrorData,
} from "./client.js";
export { GitHubClient, GitHubError } from "./client.js";

export type {
  Repository,
  Branch,
  Commit,
  CreateRepoOptions,
  ListReposOptions,
  GetContentOptions,
  ContentFile,
} from "./repos.js";
export { Repos } from "./repos.js";

export type {
  Issue,
  IssueComment,
  CreateIssueOptions,
  ListIssuesOptions,
  UpdateIssueOptions,
  IssueLabel,
} from "./issues.js";
export { Issues } from "./issues.js";

export type {
  PullRequest,
  PullRequestReview,
  CreatePROptions,
  ListPROptions,
  MergePROptions,
  MergePRResult,
} from "./pulls.js";
export { Pulls } from "./pulls.js";

export type {
  Workflow,
  WorkflowRun,
  WorkflowJob,
  ListWorkflowRunsOptions,
} from "./actions.js";
export { Actions } from "./actions.js";

export type {
  User,
  Organization,
  AuthenticatedUser,
} from "./users.js";
export { Users } from "./users.js";

export { GitHub } from "./github.js";
