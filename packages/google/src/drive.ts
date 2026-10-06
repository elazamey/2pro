import { google } from "googleapis";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  shared?: boolean;
  starred?: boolean;
  trashed?: boolean;
  owners?: Array<{ displayName: string; emailAddress: string; photoLink?: string }>;
  capabilities?: Record<string, boolean>;
}

export interface DriveListOptions {
  /** Search query (Google Drive query syntax). E.g. "mimeType='application/pdf'" */
  query?: string;
  pageSize?: number;
  pageToken?: string;
  /** Folder id, or "root" */
  folderId?: string;
  orderBy?: string;
  includeTeamDriveItems?: boolean;
  trashed?: boolean;
}

export interface DriveListResult {
  files: DriveFile[];
  nextPageToken?: string | null;
}

export interface UploadOptions {
  name: string;
  /** One of 'media' (simple), 'multipart', or 'resumable'. Default 'multipart'. */
  uploadType?: "media" | "multipart" | "resumable";
  parentFolderId?: string;
  mimeType?: string;
  /** Existing file id to update. */
  fileId?: string;
  body?: string | Buffer | Readable;
  /** Local filesystem path (alternative to body). */
  filePath?: string;
}

export class Drive {
  constructor(private auth: any) {}

  private drive = () => google.drive({ version: "v3", auth: this.auth });

  async list(opts: DriveListOptions = {}): Promise<DriveListResult> {
    const qParts: string[] = [];
    if (opts.folderId) {
      qParts.push(`'${opts.folderId}' in parents`);
    }
    if (opts.trashed === false) qParts.push("trashed = false");
    if (opts.query) qParts.push(`(${opts.query})`);
    const q = qParts.length ? qParts.join(" and ") : undefined;
    const res = await this.drive().files.list({
      q,
      pageSize: opts.pageSize ?? 20,
      pageToken: opts.pageToken,
      orderBy: opts.orderBy ?? "modifiedTime desc",
      includeItemsFromAllDrives: opts.includeTeamDriveItems,
      supportsAllDrives: opts.includeTeamDriveItems,
      corpora: opts.includeTeamDriveItems ? "allDrives" : undefined,
      fields: "nextPageToken, files(id,name,mimeType,webViewLink,webContentLink,iconLink,size,createdTime,modifiedTime,parents,shared,starred,trashed,owners(displayName,emailAddress,photoLink),capabilities)",
    });
    return { files: (res.data.files ?? []) as DriveFile[], nextPageToken: res.data.nextPageToken };
  }

  async get(fileId: string): Promise<DriveFile> {
    const res = await this.drive().files.get({ fileId, fields: "*" });
    return res.data as unknown as DriveFile;
  }

  async upload(opts: UploadOptions): Promise<DriveFile> {
    const mediaBody = opts.filePath ? createReadStream(opts.filePath) : opts.body;
    const metadata: Record<string, unknown> = { name: opts.name };
    if (opts.parentFolderId) metadata.parents = [opts.parentFolderId];
    if (opts.mimeType) metadata.mimeType = opts.mimeType;

    const method = opts.fileId ? "update" : "create";
    const params: any = {
      media: { mimeType: opts.mimeType ?? "application/octet-stream", body: mediaBody },
      fields: "id,name,mimeType,webViewLink,webContentLink,size,parents",
      uploadType: opts.uploadType ?? "multipart",
      requestBody: metadata,
      supportsAllDrives: true,
    };
    if (opts.fileId) params.fileId = opts.fileId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (this.drive().files as any)[method](params);
    return res.data as DriveFile;
  }

  async createFolder(name: string, parentFolderId = "root"): Promise<DriveFile> {
    const res = await this.drive().files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentFolderId] },
      fields: "id,name,mimeType,webViewLink,parents",
      supportsAllDrives: true,
    });
    return res.data as unknown as DriveFile;
  }

  async delete(fileId: string): Promise<void> {
    await this.drive().files.delete({ fileId, supportsAllDrives: true });
  }

  async search(query: string, opts: Omit<DriveListOptions, "query"> = {}): Promise<DriveListResult> {
    // Wrap user query with name contains (most common case) unless it looks like an advanced query.
    const looksAdvanced = /(contains|=|\(|\)|mimeType|trashed|parents)/.test(query);
    return this.list({ ...opts, query: looksAdvanced ? query : `name contains '${query.replace(/'/g, "\\'")}'` });
  }

  /** Generate a direct download URL for a file (works only if the OAuth token is used). */
  downloadUrl(fileId: string): string {
    return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }
}
