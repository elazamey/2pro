"""Resource wrappers: URL construction, payload mapping and write calls."""

from __future__ import annotations

from tests.conftest import (
    MockAPI,
    issue_payload,
    pr_payload,
    repo_payload,
    run_payload,
    user_payload,
)
from twopro.models import (
    Branch,
    Issue,
    Job,
    PullRequest,
    Release,
    Repository,
    User,
    Workflow,
    WorkflowRun,
)

# ---------------------------------------------------------------------- repos


def test_get_repository(gh, api: MockAPI) -> None:
    api.get("/repos/elazamey/2pro", json=repo_payload())
    repo = gh.repos.get("elazamey", "2pro")
    assert isinstance(repo, Repository)
    assert repo.full_name == "elazamey/2pro"


def test_list_repos_for_user(gh, api: MockAPI) -> None:
    api.get(
        "/users/elazamey/repos?per_page=100&type=owner&sort=updated&direction=desc",
        json=[repo_payload("a"), repo_payload("b")],
    )
    repos = list(gh.repos.list_for_user("elazamey"))
    assert [r.name for r in repos] == ["a", "b"]


def test_list_repos_for_org(gh, api: MockAPI) -> None:
    api.get(
        "/orgs/acme/repos?per_page=100&type=all&sort=updated&direction=desc",
        json=[repo_payload("x")],
    )
    assert [r.name for r in gh.repos.list_for_org("acme")] == ["x"]


def test_list_repos_for_authenticated_user(gh, api: MockAPI) -> None:
    api.get(
        "/user/repos?per_page=100&visibility=all&sort=updated&direction=desc",
        json=[repo_payload("mine")],
    )
    assert [r.name for r in gh.repos.list_for_authenticated_user()] == ["mine"]


def test_create_repo_for_org(gh, api: MockAPI) -> None:
    api.post("/orgs/acme/repos", json=repo_payload("new", owner="acme"))
    repo = gh.repos.create("new", org="acme", private=True, description="d")
    assert repo.full_name == "acme/new"
    assert api.request_bodies()[0] == {
        "name": "new",
        "private": True,
        "description": "d",
        "auto_init": False,
        "has_issues": True,
        "has_wiki": True,
    }


def test_create_repo_for_user(gh, api: MockAPI) -> None:
    api.post("/user/repos", json=repo_payload("solo"))
    gh.repos.create("solo")
    assert api.called("POST", "/user/repos")


def test_delete_repo(gh, api: MockAPI) -> None:
    api.route("DELETE", "/repos/a/b", status=204)
    assert gh.repos.delete("a", "b") is True


def test_update_repo(gh, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b", json=repo_payload("b", owner="a", description="new"))
    assert gh.repos.update("a", "b", description="new").description == "new"


def test_branches(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/branches?per_page=100",
        json=[{"name": "main", "commit": {"sha": "abc"}, "protected": True}],
    )
    branch = next(gh.repos.branches("a", "b"))
    assert isinstance(branch, Branch)
    assert branch.sha == "abc" and branch.protected is True


def test_topics(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/topics", json={"names": ["cli", "github"]})
    assert gh.repos.topics("a", "b") == ["cli", "github"]


def test_replace_topics(gh, api: MockAPI) -> None:
    api.route("PUT", "/repos/a/b/topics", json={"names": ["new"]})
    assert gh.repos.replace_topics("a", "b", ["new"]) == ["new"]


def test_releases_and_latest(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/releases?per_page=100",
        json=[{"tag_name": "v1.0.0", "name": "First", "assets": [{"id": 1}]}],
    )
    release = next(gh.repos.releases("a", "b"))
    assert (
        isinstance(release, Release) and release.tag_name == "v1.0.0" and len(release.assets) == 1
    )


def test_readme_is_decoded(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/readme", text="# hello\n")
    assert gh.repos.readme("a", "b") == "# hello\n"


def test_file_contents_decodes_base64(gh, api: MockAPI) -> None:
    import base64

    encoded = base64.b64encode(b"print('hi')").decode()
    api.get("/repos/a/b/contents/app.py", json={"encoding": "base64", "content": encoded})
    assert gh.repos.file_contents("a", "b", "/app.py") == "print('hi')"


def test_languages(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/languages", json={"Python": 1200})
    assert gh.repos.languages("a", "b") == {"Python": 1200}


# --------------------------------------------------------------------- issues


def test_get_issue(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/issues/3", json=issue_payload(3, title="Broken"))
    issue = gh.issues.get("a", "b", 3)
    assert isinstance(issue, Issue) and issue.title == "Broken"


def test_list_issues_filters_out_pull_requests(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/issues?per_page=100&state=open&sort=created&direction=desc",
        json=[issue_payload(1), issue_payload(2, pull_request={"url": "x"})],
    )
    issues = list(gh.issues.list("a", "b"))
    assert [i.number for i in issues] == [1]


def test_list_issues_sends_filters(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/issues?per_page=100&state=closed&labels=bug%2Cui&assignee=me", json=[])
    list(gh.issues.list("a", "b", state="closed", labels="bug,ui", assignee="me"))
    query = api.calls[0].url.query.decode()
    assert "state=closed" in query
    assert "labels=bug%2Cui" in query


def test_create_issue(gh, api: MockAPI) -> None:
    api.post("/repos/a/b/issues", json=issue_payload(9, title="New"))
    issue = gh.issues.create("a", "b", "New", body="body", labels="bug,ui")
    assert issue.number == 9
    assert api.request_bodies()[0] == {"title": "New", "body": "body", "labels": ["bug", "ui"]}


def test_close_issue_sets_state_and_reason(gh, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b/issues/4", json=issue_payload(4, state="closed"))
    issue = gh.issues.close("a", "b", 4, reason="not_planned")
    assert issue.state == "closed"
    assert api.request_bodies()[0] == {"state": "closed", "state_reason": "not_planned"}


def test_reopen_issue(gh, api: MockAPI) -> None:
    api.route("PATCH", "/repos/a/b/issues/4", json=issue_payload(4, state="open"))
    assert gh.issues.reopen("a", "b", 4).state == "open"


def test_comment_on_issue(gh, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/2/comments", json={"id": 1, "body": "hi", "user": user_payload()})
    comment = gh.issues.comment("a", "b", 2, "hi")
    assert comment.body == "hi"
    assert api.request_bodies()[0] == {"body": "hi"}


def test_list_comments(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/issues/2/comments?per_page=100",
        json=[{"id": 1, "body": "one", "user": user_payload()}],
    )
    assert [c.body for c in gh.issues.comments("a", "b", 2)] == ["one"]


def test_add_labels(gh, api: MockAPI) -> None:
    api.post("/repos/a/b/issues/2/labels", json=[{"id": 1, "name": "bug"}])
    assert [label.name for label in gh.issues.add_labels("a", "b", 2, ["bug"])] == ["bug"]
    assert api.request_bodies()[0] == {"labels": ["bug"]}


def test_remove_label(gh, api: MockAPI) -> None:
    api.route("DELETE", "/repos/a/b/issues/2/labels/bug", status=204)
    assert gh.issues.remove_label("a", "b", 2, "bug") is True


def test_lock_and_unlock(gh, api: MockAPI) -> None:
    api.route("PUT", "/repos/a/b/issues/2/lock", status=204)
    api.route("DELETE", "/repos/a/b/issues/2/lock", status=204)
    assert gh.issues.lock("a", "b", 2) is True
    assert gh.issues.unlock("a", "b", 2) is True


def test_list_issues_for_authenticated_user(gh, api: MockAPI) -> None:
    api.get(
        "/issues?per_page=100&state=open&filter=assigned&sort=updated&direction=desc",
        json=[issue_payload(1)],
    )
    assert len(list(gh.issues.list_for_authenticated_user())) == 1


# ---------------------------------------------------------------------- pulls


def test_get_pull_request(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    pr = gh.pulls.get("a", "b", 5)
    assert isinstance(pr, PullRequest) and pr.head_ref == "feature"


def test_list_pull_requests(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls?per_page=100&state=open&sort=created&direction=desc",
        json=[pr_payload(5), pr_payload(6)],
    )
    assert len(list(gh.pulls.list("a", "b"))) == 2


def test_create_pull_request(gh, api: MockAPI) -> None:
    api.post("/repos/a/b/pulls", json=pr_payload(7))
    pr = gh.pulls.create("a", "b", title="T", head="feat", base="main", draft=True)
    assert pr.number == 7
    assert api.request_bodies()[0]["draft"] is True


def test_merge_pull_request(gh, api: MockAPI) -> None:
    api.route("PUT", "/repos/a/b/pulls/5/merge", json={"merged": True, "message": "ok"})
    result = gh.pulls.merge("a", "b", 5, method="squash")
    assert result["merged"] is True
    assert api.request_bodies()[0] == {"merge_method": "squash"}


def test_pull_request_files(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls/5/files?per_page=100",
        json=[{"filename": "app.py", "additions": 3, "deletions": 1}],
    )
    files = list(gh.pulls.files("a", "b", 5))
    assert files[0]["filename"] == "app.py"


def test_pull_request_reviews(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls/5/reviews?per_page=100",
        json=[{"id": 1, "state": "APPROVED", "user": user_payload("reviewer")}],
    )
    review = next(gh.pulls.reviews("a", "b", 5))
    assert review.state == "APPROVED"


def test_create_review(gh, api: MockAPI) -> None:
    api.post("/repos/a/b/pulls/5/reviews", json={"id": 2, "state": "APPROVED"})
    review = gh.pulls.create_review("a", "b", 5, event="APPROVE", body="lgtm")
    assert review.state == "APPROVED"
    assert api.request_bodies()[0] == {"event": "APPROVE", "body": "lgtm"}


def test_request_reviewers(gh, api: MockAPI) -> None:
    api.post("/repos/a/b/pulls/5/requested_reviewers", json=pr_payload(5))
    gh.pulls.request_reviewers("a", "b", 5, reviewers=["octocat"])
    assert api.request_bodies()[0] == {"reviewers": ["octocat"], "team_reviewers": []}


def test_check_runs_and_status(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/commits/abc123/check-runs?per_page=100",
        json={"total_count": 1, "check_runs": [{"id": 1, "name": "test", "conclusion": "success"}]},
    )
    runs = list(gh.pulls.check_runs("a", "b", "abc123"))
    assert runs[0]["name"] == "test"

    api.get("/repos/a/b/commits/abc123/status", json={"state": "success", "statuses": []})
    assert gh.pulls.combined_status("a", "b", "abc123")["state"] == "success"


def test_is_green(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/pulls/5", json=pr_payload(5))
    api.get("/repos/a/b/commits/abc123/status", json={"state": "success"})
    assert gh.pulls.is_green("a", "b", 5) is True


def test_pull_commits(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/pulls/5/commits?per_page=100",
        json=[{"sha": "abc1234567", "commit": {"message": "feat: x"}}],
    )
    commit = next(gh.pulls.commits("a", "b", 5))
    assert commit.short_sha == "abc12345" and commit.message == "feat: x"


# -------------------------------------------------------------------- actions


def test_list_workflows(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/workflows?per_page=100",
        json={
            "total_count": 1,
            "workflows": [{"id": 10, "name": "CI", "path": ".github/workflows/ci.yml"}],
        },
    )
    workflow = next(gh.actions.workflows("a", "b"))
    assert isinstance(workflow, Workflow) and workflow.name == "CI"


def test_list_runs(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/runs?per_page=100&branch=main",
        json={"total_count": 1, "workflow_runs": [run_payload(11)]},
    )
    run = next(gh.actions.runs("a", "b", branch="main"))
    assert isinstance(run, WorkflowRun) and run.id == 11


def test_runs_for_specific_workflow(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/workflows/10/runs?per_page=100",
        json={"workflow_runs": [run_payload(12)]},
    )
    assert next(gh.actions.runs("a", "b", workflow_id=10)).id == 12


def test_latest_run(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/runs?per_page=100",
        json={"workflow_runs": [run_payload(1), run_payload(2)]},
    )
    assert gh.actions.latest_run("a", "b").id == 1


def test_latest_run_returns_none_when_empty(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs?per_page=100", json={"workflow_runs": []})
    assert gh.actions.latest_run("a", "b") is None


def test_run_detail_and_attempt(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs/11", json=run_payload(11))
    api.get("/repos/a/b/actions/runs/11/attempts/2", json=run_payload(11, run_attempt=2))
    assert gh.actions.run("a", "b", 11).id == 11
    assert gh.actions.run("a", "b", 11, attempt=2).run_attempt == 2


def test_rerun_and_cancel(gh, api: MockAPI) -> None:
    api.route("POST", "/repos/a/b/actions/runs/11/rerun", status=201)
    api.route("POST", "/repos/a/b/actions/runs/11/rerun-failed-jobs", status=201)
    api.route("POST", "/repos/a/b/actions/runs/11/cancel", status=202)
    assert gh.actions.rerun("a", "b", 11) is True
    assert gh.actions.rerun("a", "b", 11, failed_only=True) is True
    assert gh.actions.cancel("a", "b", 11) is True


def test_jobs(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/runs/11/jobs?per_page=100",
        json={
            "total_count": 1,
            "jobs": [
                {
                    "id": 1,
                    "name": "build",
                    "status": "completed",
                    "conclusion": "success",
                    "steps": [{"name": "checkout"}],
                }
            ],
        },
    )
    job = next(gh.actions.jobs("a", "b", 11))
    assert isinstance(job, Job) and job.name == "build" and len(job.steps) == 1


def test_artifacts(gh, api: MockAPI) -> None:
    api.get(
        "/repos/a/b/actions/runs/11/artifacts?per_page=100",
        json={"artifacts": [{"id": 3, "name": "dist", "size_in_bytes": 2048}]},
    )
    artifact = next(gh.actions.artifacts("a", "b", 11))
    assert artifact.size_human == "2.0 KB"


def test_logs_and_download(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/runs/11/logs", text="log-bytes")
    assert gh.actions.logs("a", "b", 11) == b"log-bytes"
    api.get("/repos/a/b/actions/jobs/5/logs", text="job-log")
    assert gh.actions.job_logs("a", "b", 5) == b"job-log"
    api.get("/repos/a/b/actions/artifacts/3/zip", text="zip-bytes")
    assert gh.actions.download_artifact("a", "b", 3) == b"zip-bytes"


def test_dispatch_workflow(gh, api: MockAPI) -> None:
    api.route("POST", "/repos/a/b/actions/workflows/ci.yml/dispatches", status=204)
    gh.actions.dispatch("a", "b", "ci.yml", ref="main", inputs={"env": "prod"})
    assert api.request_bodies()[0] == {"ref": "main", "inputs": {"env": "prod"}}


def test_secrets(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/actions/secrets?per_page=100", json={"secrets": [{"name": "PYPI_TOKEN"}]})
    assert [s["name"] for s in gh.actions.secrets("a", "b")] == ["PYPI_TOKEN"]


# ---------------------------------------------------------------- user / orgs


def test_users_me(gh, api: MockAPI) -> None:
    api.get("/user", json=user_payload("elazamey", name="Sayed"))
    user = gh.users.me()
    assert isinstance(user, User) and user.display_name == "Sayed"


def test_users_get_and_repos(gh, api: MockAPI) -> None:
    api.get("/users/octocat", json=user_payload("octocat"))
    assert gh.users.get("octocat").login == "octocat"
    api.get(
        "/users/octocat/repos?per_page=100&type=owner&sort=updated&direction=desc",
        json=[repo_payload("hello", owner="octocat")],
    )
    assert [r.name for r in gh.users.repos("octocat")] == ["hello"]


def test_users_orgs_defaults_to_viewer(gh, api: MockAPI) -> None:
    api.get("/user/orgs?per_page=100", json=[{"login": "acme"}])
    assert [o.login for o in gh.users.orgs()] == ["acme"]


def test_orgs_get_members_repos(gh, api: MockAPI) -> None:
    api.get("/orgs/acme", json={"login": "acme", "public_repos": 3})
    api.get("/orgs/acme/members?per_page=100&role=all", json=[user_payload("m1")])
    api.get(
        "/orgs/acme/repos?per_page=100&type=all&sort=updated&direction=desc",
        json=[repo_payload("r1", owner="acme")],
    )
    assert gh.orgs.get("acme").login == "acme"
    assert [m.login for m in gh.orgs.members("acme")] == ["m1"]
    assert [r.name for r in gh.orgs.repos("acme")] == ["r1"]


def test_orgs_is_member(gh, api: MockAPI) -> None:
    api.get("/orgs/acme/members/octocat", json={}, status=204)
    assert gh.orgs.is_member("acme", "octocat") is True
    api.route("GET", "/orgs/acme/members/nope", status=404, json={"message": "Not Found"})
    assert gh.orgs.is_member("acme", "nope") is False


def test_orgs_teams(gh, api: MockAPI) -> None:
    api.get("/orgs/acme/teams?per_page=100", json={"teams": [{"name": "core"}]})
    assert [t["name"] for t in gh.orgs.teams("acme")] == ["core"]


# -------------------------------------------------------------------- search


def test_search_repositories(gh, api: MockAPI) -> None:
    api.get(
        "/search/repositories?per_page=100&q=language%3Apython&order=desc",
        json={"total_count": 1, "items": [repo_payload("found")]},
    )
    assert [r.name for r in gh.search.repositories("language:python")] == ["found"]


def test_search_issues(gh, api: MockAPI) -> None:
    api.get(
        "/search/issues?per_page=100&q=is%3Aopen&order=desc",
        json={"total_count": 1, "items": [issue_payload(1)]},
    )
    assert [i.number for i in gh.search.issues("is:open")] == [1]


def test_search_count(gh, api: MockAPI) -> None:
    api.get("/search/repositories?q=2pro&per_page=1", json={"total_count": 7})
    assert gh.search.count("repositories", "2pro") == 7


# ---------------------------------------------------------------- repo handle


def test_repo_handle(gh, api: MockAPI) -> None:
    api.get("/repos/a/b/issues?per_page=100&state=open&sort=created&direction=desc", json=[])
    api.get("/repos/a/b/pulls?per_page=100&state=open&sort=created&direction=desc", json=[])
    api.get("/repos/a/b/actions/runs?per_page=100", json={"workflow_runs": []})
    handle = gh.repo("a/b")
    assert handle.full_name == "a/b"
    assert list(handle.issues()) == []
    assert list(handle.pulls()) == []
    assert list(handle.runs()) == []


def test_github_repr_and_page(gh, api: MockAPI) -> None:
    api.get("/user/repos?per_page=100", json=[])
    assert "github.com" in repr(gh)
    assert gh.rate_limit is None or gh.rate_limit is not None
