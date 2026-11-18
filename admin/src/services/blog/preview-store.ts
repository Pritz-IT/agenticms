import { randomBytes } from "crypto";
import { EventEmitter } from "events";

export interface PreviewOwner {
  userId: string;
  siteKey: string;
  postKey: string;
}

export interface PreviewSnapshot extends PreviewOwner {
  token: string;
  html: string | null;
  version: number;
  expiresAt: number;
}

// ponytail: in-memory, single admin process (the build mutex already assumes one).
// Move to Postgres + LISTEN/NOTIFY if admin ever scales out. Tokens are the map key
// as-is: hashing them would protect nothing inside the process holding the map.
export class PreviewStore {
  private readonly snapshots = new Map<string, PreviewSnapshot>();
  private readonly tokensByOwner = new Map<string, string>();
  private readonly changes = new EventEmitter();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly ttlMs = 30 * 60_000, private readonly now = () => Date.now()) {
    this.changes.setMaxListeners(0);
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  /** The live token for this editor and post, or a new one. Slides the expiry. */
  open(owner: PreviewOwner): PreviewSnapshot {
    const ownerKey = `${owner.userId}\0${owner.siteKey}\0${owner.postKey}`;
    const existing = this.get(this.tokensByOwner.get(ownerKey) ?? "");
    if (existing) {
      existing.expiresAt = this.now() + this.ttlMs;
      return existing;
    }
    const snapshot: PreviewSnapshot = {
      ...owner, token: randomBytes(32).toString("base64url"), html: null, version: 0, expiresAt: this.now() + this.ttlMs,
    };
    this.snapshots.set(snapshot.token, snapshot);
    this.tokensByOwner.set(ownerKey, snapshot.token);
    return snapshot;
  }

  publish(token: string, html: string): number {
    const snapshot = this.get(token);
    if (!snapshot) throw new Error("Preview snapshot expired");
    snapshot.html = html;
    snapshot.version += 1;
    snapshot.expiresAt = this.now() + this.ttlMs;
    this.changes.emit(token, snapshot.version);
    return snapshot.version;
  }

  get(token: string): PreviewSnapshot | null {
    const snapshot = this.snapshots.get(token);
    if (!snapshot) return null;
    if (snapshot.expiresAt <= this.now()) {
      this.remove(snapshot);
      return null;
    }
    return snapshot;
  }

  subscribe(token: string, listener: (version: number) => void): () => void {
    this.changes.on(token, listener);
    return () => this.changes.off(token, listener);
  }

  sweep(): number {
    let removed = 0;
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.expiresAt <= this.now()) {
        this.remove(snapshot);
        removed += 1;
      }
    }
    return removed;
  }

  close(): void {
    clearInterval(this.sweeper);
  }

  private remove(snapshot: PreviewSnapshot): void {
    this.snapshots.delete(snapshot.token);
    this.tokensByOwner.delete(`${snapshot.userId}\0${snapshot.siteKey}\0${snapshot.postKey}`);
  }
}
