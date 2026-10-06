import { google } from "googleapis";
import type { Credentials, OAuth2Client } from "google-auth-library";

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  /** Sender's From header (parsed) */
  from?: { name?: string; email?: string };
  subject?: string;
  snippet?: string;
  /** Unix epoch ms */
  internalDate?: number;
  labels?: string[];
  unread?: boolean;
}

export interface GmailMessage extends GmailMessageSummary {
  textPlain?: string;
  textHtml?: string;
  to?: { name?: string; email?: string }[];
  cc?: { name?: string; email?: string }[];
}

export interface GmailListOptions {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  /** Include spam/trash defaults to false. */
  includeSpamTrash?: boolean;
}

export interface GmailListResult {
  messages: GmailMessageSummary[];
  nextPageToken?: string | null;
  resultSizeEstimate?: number;
}

export interface SendOptions {
  to: string | string[];
  subject: string;
  /** Plain-text body */
  body: string;
  /** Optional HTML body (multipart/alternative) */
  htmlBody?: string;
  cc?: string | string[];
  bcc?: string | string[];
  from?: string;
  /** Reply to an existing thread */
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
  labelListVisibility?: string;
  messageListVisibility?: string;
}

interface MessageHeader { name: string; value: string; }
function getHeaders(payload: any): MessageHeader[] {
  return (payload?.headers ?? []).filter((h: any) => h && typeof h.name === "string" && typeof h.value === "string") as MessageHeader[];
}

function parseHeader(name: string, headers: MessageHeader[] = []): string | undefined {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function parseAddressList(s?: string): { name?: string; email?: string }[] {
  if (!s) return [];
  // Simple parser for "Name <email@x>, Other <other@x>"
  return s.split(",").map(p => {
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(p.trim());
    if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || undefined, email: m[2] };
    return { email: p.trim() };
  });
}

function parseAddress(s?: string): { name?: string; email?: string } | undefined {
  return parseAddressList(s)[0];
}

function decodeBase64Url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(padded, "base64");
  return buf.toString("utf-8");
}

function encodeBase64Url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function findPart(parts: any[] | undefined, mime: string): any {
  if (!parts) return undefined;
  for (const p of parts) {
    if (p.mimeType === mime && p.body?.data) return p;
    const sub = findPart(p.parts, mime);
    if (sub) return sub;
  }
  return undefined;
}

function extractBodies(payload: any): { textPlain?: string; textHtml?: string } {
  const bodies: { textPlain?: string; textHtml?: string } = {};
  if (!payload) return bodies;
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    bodies.textPlain = decodeBase64Url(payload.body.data);
  } else if (payload.mimeType === "text/html" && payload.body?.data) {
    bodies.textHtml = decodeBase64Url(payload.body.data);
  }
  const plain = findPart(payload.parts, "text/plain");
  const html = findPart(payload.parts, "text/html");
  if (plain) bodies.textPlain = decodeBase64Url(plain.body.data);
  if (html) bodies.textHtml = decodeBase64Url(html.body.data);
  return bodies;
}

export class Gmail {
  constructor(private auth: OAuth2Client) {}

  private gmail = () => google.gmail({ version: "v1", auth: this.auth });

  async list(opts: GmailListOptions = {}): Promise<GmailListResult> {
    const res = await this.gmail().users.messages.list({
      userId: "me",
      q: opts.query,
      maxResults: opts.maxResults ?? 20,
      pageToken: opts.pageToken,
      labelIds: opts.labelIds,
      includeSpamTrash: opts.includeSpamTrash,
    });
    const messages = res.data.messages ?? [];
    // We want headers, so fetch minimal metadata for each message in parallel.
    // To avoid N+1 blowups, batch via getBatch (but for simplicity: use format=METADATA individually).
    const full: GmailMessageSummary[] = await Promise.all(
      messages.map(async (m: any) => {
        const d = await this.gmail().users.messages.get({
          userId: "me", id: m.id, format: "METADATA",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = getHeaders(d.data.payload);
        const labelIds = d.data.labelIds ?? [];
        return {
          id: d.data.id!,
          threadId: d.data.threadId!,
          from: parseAddress(parseHeader("From", headers)),
          subject: parseHeader("Subject", headers),
          snippet: d.data.snippet ?? undefined,
          internalDate: d.data.internalDate ? Number(d.data.internalDate) : undefined,
          labels: labelIds as string[],
          unread: labelIds.includes("UNREAD"),
        };
      }),
    );
    return { messages: full, nextPageToken: res.data.nextPageToken, resultSizeEstimate: res.data.resultSizeEstimate ?? undefined };
  }

  async get(messageId: string): Promise<GmailMessage> {
    const d = await this.gmail().users.messages.get({ userId: "me", id: messageId, format: "FULL" });
    const headers = getHeaders(d.data.payload);
    const labelIds = d.data.labelIds ?? [];
    const bodies = extractBodies(d.data.payload);
    return {
      id: d.data.id!,
      threadId: d.data.threadId!,
      from: parseAddress(parseHeader("From", headers)),
      subject: parseHeader("Subject", headers),
      snippet: d.data.snippet ?? undefined,
      internalDate: d.data.internalDate ? Number(d.data.internalDate) : undefined,
      labels: labelIds as string[],
      unread: labelIds.includes("UNREAD"),
      to: parseAddressList(parseHeader("To", headers)),
      cc: parseAddressList(parseHeader("Cc", headers)),
      ...bodies,
    };
  }

  async listLabels(): Promise<GmailLabel[]> {
    const res = await this.gmail().users.labels.list({ userId: "me" });
    return (res.data.labels ?? []) as GmailLabel[];
  }

  async markRead(messageId: string): Promise<void> {
    await this.gmail().users.messages.modify({
      userId: "me", id: messageId, requestBody: { removeLabelIds: ["UNREAD"] },
    });
  }

  async trash(messageId: string): Promise<void> {
    await this.gmail().users.messages.trash({ userId: "me", id: messageId });
  }

  async send(opts: SendOptions): Promise<{ id: string; threadId?: string; labelIds?: string[] }> {
    const to = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    const cc = opts.cc ? (Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc) : undefined;
    const bcc = opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc.join(", ") : opts.bcc) : undefined;
    const from = opts.from ?? "me";

    const boundary = "----_2pro_boundary_" + Math.random().toString(36).slice(2);
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      bcc ? `Bcc: ${bcc}` : null,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
      opts.references?.length ? `References: ${opts.references.join(" ")}` : null,
      opts.htmlBody
        ? `Content-Type: multipart/alternative; boundary="${boundary}"`
        : "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
    ].filter(Boolean);

    let raw: string;
    if (opts.htmlBody) {
      raw = [
        ...headers,
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "",
        opts.body,
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "",
        opts.htmlBody,
        `--${boundary}--`,
        "",
      ].join("\r\n");
    } else {
      raw = [...headers, opts.body, ""].join("\r\n");
    }

    const encoded = encodeBase64Url(Buffer.from(raw, "utf-8"));
    const res = await this.gmail().users.messages.send({
      userId: "me",
      requestBody: { raw: encoded, threadId: opts.threadId },
    });
    return { id: res.data.id!, threadId: res.data.threadId ?? undefined, labelIds: res.data.labelIds as string[] | undefined };
  }

  async createDraft(opts: SendOptions): Promise<{ id: string }> {
    // Re-use MIME builder
    const msg = await this.buildRawMessage(opts);
    const res = await this.gmail().users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: msg, threadId: opts.threadId } },
    });
    return { id: res.data.id! };
  }

  private async buildRawMessage(opts: SendOptions): Promise<string> {
    const to = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    const cc = opts.cc ? (Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc) : undefined;
    const from = opts.from ?? "me";
    const boundary = "----_2pro_boundary_" + Math.random().toString(36).slice(2);
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      opts.htmlBody
        ? `Content-Type: multipart/alternative; boundary="${boundary}"`
        : "Content-Type: text/plain; charset=UTF-8",
      "",
    ].filter(Boolean);
    let raw: string;
    if (opts.htmlBody) {
      raw = [
        ...headers,
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "",
        opts.body,
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "",
        opts.htmlBody,
        `--${boundary}--`,
        "",
      ].join("\r\n");
    } else {
      raw = [...headers, opts.body, ""].join("\r\n");
    }
    return encodeBase64Url(Buffer.from(raw, "utf-8"));
  }

  /** Count of unread messages in the inbox (useful for dashboards). */
  async unreadCount(): Promise<number> {
    const res = await this.gmail().users.labels.get({ userId: "me", id: "UNREAD" });
    return res.data.messagesUnread ?? 0;
  }
}
