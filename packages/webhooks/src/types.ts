export type EventSource = "github" | "gitlab";

export interface WebhookEvent {
  id: string;
  source: EventSource;
  type: string;          // e.g. "push", "pull_request.opened", "pipeline.failed"
  deliveredAt: string;   // ISO
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

export interface AutomationContext {
  event: WebhookEvent;
  /** Caller-provided logger */
  log: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
  /** Mutable bag actions can write results into */
  results: Array<{ action: string; ok: boolean; detail?: string }>;
}

export interface AutomationAction {
  /** Short unique id e.g. "notify-on-failure" */
  id: string;
  /** Human description */
  description: string;
  /** Return true if this action should fire for the event */
  matches: (ev: WebhookEvent) => boolean | Promise<boolean>;
  /** Execute the side effect */
  run: (ctx: AutomationContext) => Promise<void>;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Simple match spec, evaluated by the built-in matcher */
  when: {
    sources?: EventSource[];
    types?: string[];           // glob-friendly: "pull_request.*", "pipeline.failed"
  };
  action: AutomationAction["id"];
  /** Action-specific config */
  config?: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}
