import type { AutomationAction, AutomationContext } from "./types.js";

/** Log every event to the results bag. Useful for audit/debug. */
export const logEventAction: AutomationAction = {
  id: "log-event",
  description: "Record a summary line for each received event",
  matches: () => true,
  async run(ctx) {
    const { event } = ctx;
    ctx.log("info", `[${event.source}] ${event.type}`, { id: event.id, valid: event.signatureValid });
    ctx.results.push({ action: this.id, ok: true, detail: `${event.source}:${event.type}` });
  },
};

/** Fire on any failed pipeline / check run — emits a warning log. */
export const failureAlertAction: AutomationAction = {
  id: "alert-on-failure",
  description: "Log a warning when a CI pipeline / check fails",
  matches(ev) {
    if (ev.source === "gitlab" && ev.type === "pipeline" && (ev.payload as any)?.object_attributes?.status === "failed") return true;
    if (ev.source === "github") {
      const t = ev.type;
      if (t === "check_run" && (ev.payload as any)?.check_run?.conclusion === "failure") return true;
      if (t === "workflow_run" && (ev.payload as any)?.workflow_run?.conclusion === "failure") return true;
      if (t === "status" && (ev.payload as any)?.state === "failure") return true;
    }
    return false;
  },
  async run(ctx) {
    const p = ctx.event.payload as any;
    const what =
      ctx.event.source === "gitlab"
        ? `${p.project?.path_with_namespace} pipeline #${p.object_attributes?.id} on ${p.object_attributes?.ref}`
        : `${p.repository?.full_name} (${ctx.event.type})`;
    ctx.log("warn", `CI failure detected: ${what}`);
    ctx.results.push({ action: this.id, ok: true, detail: what });
  },
};

/** Fire on successful GitHub PR merge — emits an info log (caller can hook Drive/Gmail/etc). */
export const mergeNotifyAction: AutomationAction = {
  id: "notify-on-merge",
  description: "Log when a pull request / merge request is merged",
  matches(ev) {
    if (ev.source === "github" && ev.type === "pull_request" && (ev.payload as any)?.action === "closed" && (ev.payload as any)?.pull_request?.merged) return true;
    if (ev.source === "gitlab" && ev.type === "merge_request" && (ev.payload as any)?.object_attributes?.state === "merged") return true;
    return false;
  },
  async run(ctx) {
    const p = ctx.event.payload as any;
    const title = (p.pull_request ?? p.object_attributes)?.title ?? "";
    const who = (p.pull_request?.merged_by?.login ?? p.user?.username ?? "unknown");
    ctx.log("info", `Merged: "${title}" by ${who}`);
    ctx.results.push({ action: this.id, ok: true, detail: title });
  },
};

/** Fire on new PR / MR opened — logs a "review needed" notice. */
export const newPrAlertAction: AutomationAction = {
  id: "alert-new-pr",
  description: "Log when a new pull/merge request is opened",
  matches(ev) {
    if (ev.source === "github" && ev.type === "pull_request" && (ev.payload as any)?.action === "opened") return true;
    if (ev.source === "gitlab" && ev.type === "merge_request" && (ev.payload as any)?.object_attributes?.action === "open") return true;
    return false;
  },
  async run(ctx) {
    const p = ctx.event.payload as any;
    const pr = p.pull_request ?? p.object_attributes;
    ctx.log("info", `New PR/MR opened: ${pr?.title} (${pr?.html_url ?? ""})`);
    ctx.results.push({ action: this.id, ok: true, detail: pr?.title });
  },
};

export const BUILTIN_ACTIONS: Record<string, AutomationAction> = {
  [logEventAction.id]: logEventAction,
  [failureAlertAction.id]: failureAlertAction,
  [mergeNotifyAction.id]: mergeNotifyAction,
  [newPrAlertAction.id]: newPrAlertAction,
};
