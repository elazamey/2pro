import { GitHubClient } from "./client.js";
import { Repos } from "./repos.js";
import { Issues } from "./issues.js";
import { Pulls } from "./pulls.js";
import { Actions } from "./actions.js";
import { Users } from "./users.js";

/**
 * Convenience client that exposes all namespaced resources as properties.
 */
export class GitHub extends GitHubClient {
  readonly repos: Repos;
  readonly issues: Issues;
  readonly pulls: Pulls;
  readonly actions: Actions;
  readonly users: Users;

  constructor(config: ConstructorParameters<typeof GitHubClient>[0] = {}) {
    super(config);
    this.repos = new Repos(this);
    this.issues = new Issues(this);
    this.pulls = new Pulls(this);
    this.actions = new Actions(this);
    this.users = new Users(this);
  }
}
