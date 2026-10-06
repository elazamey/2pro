/**
 * GitHub OAuth 2.0 Web Flow helpers.
 *
 * 1. Build an authorize URL and redirect the user.
 * 2. GitHub redirects back with a `code`.
 * 3. Exchange code for an access token (POST to GitHub's /login/oauth/access_token).
 * 4. Fetch the authenticated user with the token.
 */

export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "2pro-dashboard",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`OAuth error: ${data.error} - ${data.error_description ?? ""}`);
  return {
    accessToken: data.access_token,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export async function fetchAuthenticatedUser(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "2pro-dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
  return res.json();
}
