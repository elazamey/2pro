import type { GitHubClient } from "./client.js";
import type { PaginatedOptions } from "./client.js";

export interface User {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  html_url: string;
  type: "User" | "Bot" | "Organization";
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  twitter_username: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedUser extends User {
  total_private_repos: number;
  owned_private_repos: number;
  collaborators: number;
  two_factor_authentication: boolean;
  plan?: {
    name: string;
    space: number;
    private_repos: number;
    collaborators: number;
  };
}

export interface Organization {
  login: string;
  id: number;
  node_id: string;
  url: string;
  avatar_url: string;
  description: string | null;
}

export class Users {
  constructor(private client: GitHubClient) {}

  /** Get the currently authenticated user. */
  async me(): Promise<AuthenticatedUser> {
    return this.client.request<AuthenticatedUser>("/user");
  }

  /** Get a user by username. */
  async get(username: string): Promise<User> {
    return this.client.request<User>(`/users/${encodeURIComponent(username)}`);
  }

  /** List orgs for the authenticated user. */
  async listMyOrgs(opts: PaginatedOptions = {}): Promise<Organization[]> {
    return this.client.collect<Organization>("/user/orgs", opts);
  }

  /** List orgs for a user. */
  async listOrgsForUser(username: string, opts: PaginatedOptions = {}): Promise<Organization[]> {
    return this.client.collect<Organization>(`/users/${encodeURIComponent(username)}/orgs`, opts);
  }
}
