/**
 * Resolving credentials.
 *
 * Google Photos has no app-password equivalent and no service-account path:
 * Google explicitly does not support service accounts for these APIs, so the
 * only way in is a real user's OAuth 2.0 grant. That shapes everything here.
 *
 * An access token lives about an hour, which is shorter than most MCP sessions,
 * so storing one is pointless. The durable credential is the refresh token, and
 * the server mints a fresh access token from it on demand.
 *
 * Three variables, all from your own Google Cloud project:
 *   GOOGLE_PHOTOS_CLIENT_ID
 *   GOOGLE_PHOTOS_CLIENT_SECRET
 *   GOOGLE_PHOTOS_REFRESH_TOKEN
 *
 * `google-photos-mcp auth` produces the third one. See references/setup.md for
 * where the first two come from.
 */

export type Config = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  readOnly: boolean;
  allowDestructive: boolean;
  requestTimeoutMs: number;
  maxRetries: number;
  userAgent: string;
  auditPath?: string;
  /** Where `auth` parks its loopback listener. Must match a registered URI. */
  authPort: number;
};

/** The scopes this server asks for, and why each one is here.
 *
 * Deliberately not `photoslibrary`, `photoslibrary.readonly` or
 * `photoslibrary.sharing`. Google removed those from new grants on
 * 2025-04-01, so requesting them now fails the consent screen outright rather
 * than degrading. Everything below still works for a project created today.
 */
export const SCOPES = [
  // Read what the user picked in Google's own picker UI. This is the only
  // route to media the app did not itself upload.
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
  // Upload new media and create albums.
  "https://www.googleapis.com/auth/photoslibrary.appendonly",
  // Read back only what this app created.
  "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
  // Edit descriptions, album covers and album membership, for app-created data.
  "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata",
] as const;

export const DEFAULT_AUTH_PORT = 4180;

/** Strip whitespace and the literal "\n" that survives a copy-paste into a
 *  JSON config or a hosting dashboard. `.trim()` only removes real whitespace,
 *  never the two-character sequence, and a secret with a trailing `\n` fails
 *  as `invalid_client`, which reads like the wrong secret rather than a dirty
 *  one. */
export function cleanEnv(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\\[nrt]/g, "").replace(/\s+/g, "").trim();
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

export function loadConfig(): Config {
  return {
    clientId: cleanEnv(process.env.GOOGLE_PHOTOS_CLIENT_ID),
    clientSecret: cleanEnv(process.env.GOOGLE_PHOTOS_CLIENT_SECRET),
    refreshToken: cleanEnv(process.env.GOOGLE_PHOTOS_REFRESH_TOKEN),
    readOnly: envFlag("GOOGLE_PHOTOS_READ_ONLY", false),
    allowDestructive: envFlag("GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE", true),
    requestTimeoutMs: envInt("GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS", 30_000),
    maxRetries: envInt("GOOGLE_PHOTOS_MAX_RETRIES", 2),
    userAgent: `google-photos-mcp/1.0.0 (+https://github.com/navidmoazzez/google-photos-mcp)`,
    auditPath: process.env.GOOGLE_PHOTOS_AUDIT_LOG?.trim() || undefined,
    authPort: envInt("GOOGLE_PHOTOS_AUTH_PORT", DEFAULT_AUTH_PORT),
  };
}

/** True when the server has everything it needs to reach the API. */
export function isConfigured(config: Config): boolean {
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

/** What is missing, phrased for someone reading it in a terminal. */
export function missingCredentials(config: Config): string[] {
  const missing: string[] = [];
  if (!config.clientId) missing.push("GOOGLE_PHOTOS_CLIENT_ID");
  if (!config.clientSecret) missing.push("GOOGLE_PHOTOS_CLIENT_SECRET");
  if (!config.refreshToken) missing.push("GOOGLE_PHOTOS_REFRESH_TOKEN");
  return missing;
}
