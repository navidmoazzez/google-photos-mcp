/**
 * Decides whether a write is allowed to reach Google Photos.
 *
 * The hazard here is narrower than on a social network, and worth stating
 * precisely so the guard is not over-applied. Nothing this server does is
 * public: Google removed album sharing from the API on 2025-03-31, so an
 * upload lands in a private library and stays there.
 *
 * One operation genuinely escapes:
 *
 *   upload_*      puts bytes in someone's real photo library, where they mix
 *                 into a lifetime of personal photos. There is no API to
 *                 delete them again; Google deliberately does not expose one.
 *                 A mistaken upload has to be cleaned up by hand in the app.
 *
 * That one requires `confirm: true`. Creating an album, renaming one, or
 * editing a description does not: each is reversible in one call and
 * confirming everything trains a model to pass confirm reflexively, which is
 * worse protection than none because it looks like a safeguard.
 *
 * GOOGLE_PHOTOS_READ_ONLY=1 removes every write from the tool list entirely.
 */

import { appendFileSync } from "node:fs";
import type { Config } from "./config.js";
import { WriteBlockedError } from "./api/errors.js";

export type Risk =
  /** Reads only. */
  | "read"
  /** Changes something reversible: an album title, a description, membership. */
  | "write"
  /** Reaches other people, or cannot be undone through this API. */
  | "destructive";

/** Which surface a guard is protecting, so a refusal names the right syntax. */
export type Surface = "mcp" | "cli";

export class WriteGuard {
  private readonly config: Config;
  private readonly surface: Surface;

  constructor(config: Config, surface: Surface = "mcp") {
    this.config = config;
    this.surface = surface;
  }

  get readOnly(): boolean {
    return this.config.readOnly;
  }

  /** A model reads `confirm: true`; a person at a terminal reads `--confirm`. */
  private get confirmFlag(): string {
    return this.surface === "cli" ? "--confirm" : "confirm: true";
  }

  check(tool: string, risk: Risk, confirm: boolean | undefined, summary: string): void {
    if (risk === "read") return;

    if (this.config.readOnly) {
      this.audit(tool, summary, "blocked: read-only");
      throw new WriteBlockedError(
        `${tool} is unavailable: this server is running with GOOGLE_PHOTOS_READ_ONLY=1.`,
      );
    }

    if (risk === "destructive") {
      if (!this.config.allowDestructive) {
        this.audit(tool, summary, "blocked: destructive disabled");
        throw new WriteBlockedError(
          `${tool} is unavailable: this server is running with GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0.`,
        );
      }
      if (confirm !== true) {
        this.audit(tool, summary, "blocked: no confirm");
        throw new WriteBlockedError(
          `${tool} cannot be undone through the API, so it will not run without ${this.confirmFlag}. About to: ${summary}. Call again with ${this.confirmFlag} if that is what was asked for.`,
        );
      }
    }

    this.audit(tool, summary, "allowed");
  }

  /** Append-only record of every attempted write, when GOOGLE_PHOTOS_AUDIT_LOG is set. */
  private audit(tool: string, summary: string, outcome: string): void {
    if (!this.config.auditPath) return;
    const line = JSON.stringify({ at: new Date().toISOString(), tool, summary, outcome });
    try {
      appendFileSync(this.config.auditPath, `${line}\n`, "utf8");
    } catch {
      /* A failed audit write must never take down the call it was recording. */
    }
  }
}

/**
 * MCP annotations, so a client can decide what to auto-approve without
 * parsing descriptions.
 */
export function annotationsFor(
  risk: Risk,
  options: { public?: boolean; idempotent?: boolean } = {},
): Record<string, boolean> {
  return {
    readOnlyHint: risk === "read",
    // Nothing here deletes a media item, because Google exposes no way to.
    // Removing an album, or an item from an album, is the destructive end of
    // what this server can reach.
    destructiveHint: risk === "destructive",
    idempotentHint: options.idempotent ?? risk === "read",
    openWorldHint: true,
  };
}
