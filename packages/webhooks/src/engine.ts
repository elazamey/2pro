import crypto from "node:crypto";
import { verify } from "./verify.js";
import { BUILTIN_ACTIONS } from "./actions.js";
import type { AutomationAction, AutomationContext, AutomationRule, EventSource, WebhookEvent } from "./types.js";

export interface EngineOptions {
  /** Webhook secrets keyed by source, e.g. { github: "...", gitlab: "..." } */
  secrets?: Partial<Record<EventSource, string>>;
  /** Initial rules */
  rules?: AutomationRule[];
  /** Custom actions beyond the built-in set */
  actions?: Record<string, AutomationAction>;
  /** Event sink for logging */
  log?: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

function typeGlobMatches(pattern: string, actual: string): boolean {
  if (pattern === actual) return true;
  if (!pattern.includes("*")) return false;
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(actual);
}

function genId() {
  return crypto.randomBytes(8).toString("hex");
}

export class WebhookEngine {
  public rules: AutomationRule[];
  public readonly actions: Record<string, AutomationAction>;
  public recent: WebhookEvent[] = [];
  private secrets: Partial<Record<EventSource, string>>;
  private log: NonNullable<EngineOptions["log"]>;

  constructor(opts: EngineOptions = {}) {
    this.secrets = opts.secrets ?? {};
    this.rules = opts.rules ?? [];
    this.actions = { ...BUILTIN_ACTIONS, ...(opts.actions ?? {}) };
    this.log = opts.log ?? ((_l, m) => console.log(m));
  }

  setSecret(source: EventSource, secret: string | undefined) {
    if (secret) this.secrets[source] = secret;
    else delete this.secrets[source];
  }

  addRule(rule: AutomationRule) {
    this.rules.push(rule);
    return rule;
  }

  removeRule(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  listActions(): Array<{ id: string; description: string }> {
    return Object.values(this.actions).map((a) => ({ id: a.id, description: a.description }));
  }

  /**
   * Process an incoming webhook raw payload and dispatch it to matching actions.
   */
  async ingest(source: EventSource, rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<{ event: WebhookEvent; results: AutomationContext["results"] }> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { _raw: rawBody };
    }
    const verifyResult = verify(source, rawBody, headers, this.secrets[source]);

    const type = detectEventType(source, headers, payload);
    const event: WebhookEvent = {
      id: (headers && (Array.isArray(headers["x-github-delivery"]) ? headers["x-github-delivery"][0] : (headers["x-github-delivery"] as string))) ||
          (headers && (Array.isArray(headers["x-gitlab-event-uuid"]) ? headers["x-gitlab-event-uuid"][0] : (headers["x-gitlab-event-uuid"] as string))) ||
          genId(),
      source,
      type,
      deliveredAt: new Date().toISOString(),
      signatureValid: verifyResult.ok,
      payload,
    };

    this.recent.unshift(event);
    if (this.recent.length > 200) this.recent.length = 200;

    if (!verifyResult.ok) {
      this.log("warn", `Rejected webhook from ${source}: ${verifyResult.reason}`);
      return { event, results: [] };
    }

    const ctx: AutomationContext = { event, log: this.log, results: [] };
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.when.sources && !rule.when.sources.includes(source)) continue;
      if (rule.when.types && !rule.when.types.some((pat) => typeGlobMatches(pat, event.type))) continue;
      const action = this.actions[rule.action];
      if (!action) { this.log("warn", `Rule ${rule.id} references unknown action ${rule.action}`); continue; }
      try {
        const matches = await action.matches(event);
        if (!matches) continue;
        await action.run(ctx);
      } catch (e) {
        this.log("error", `Action ${action.id} failed: ${(e as Error).message}`);
        ctx.results.push({ action: action.id, ok: false, detail: (e as Error).message });
      }
    }
    return { event, results: ctx.results };
  }
}

function detectEventType(source: EventSource, headers: Record<string, string | string[] | undefined>, payload: Record<string, unknown>): string {
  const get = (k: string) => {
    const v = headers[k] ?? headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  if (source === "github") {
    const ev = get("x-github-event") ?? "unknown";
    const action = (payload as any).action;
    return action ? `${ev}.${action}` : ev;
  }
  if (source === "gitlab") {
    return (get("x-gitlab-event") ?? "unknown").replace(" Hook", "").replace(/\s+/g, "_").toLowerCase();
  }
  return "unknown";
}
