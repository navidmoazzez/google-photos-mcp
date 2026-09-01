/**
 * Resolving credentials, and the multi-account model.
 *
 * Google Photos has no app-password equivalent and no service-account path:
 * Google explicitly does not support service accounts for these APIs, so the
 * only way in is a real user's OAuth 2.0 grant.
 *
 * An access token lives about an hour, which is shorter than most MCP sessions,
 * so storing one is pointless. The durable credential is the refresh token, and
 * each account mints a fresh access token from its own.
 *
 * Two sources, in priority order:
 *   1. GOOGLE_PHOTOS_ACCOUNTS   a JSON array, for several accounts at once
 *   2. GOOGLE_PHOTOS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN
 *
 * One account read from the environment is fine until you run a personal
 * library and a brand library from the same client, at which point you are
 * restarting the server to switch. Every account-scoped tool takes an optional
 * `account` argument, and the one that acts when none is named is chosen
 * deliberately (see `selectAccount`) rather than being whichever came first.
 *
 * Each account carries its own client id and secret, because a refresh token
 * only works with the OAuth client that minted it. Two Google accounts
 * authorised through the same Cloud project can share those two values, and
 * two accounts from different projects cannot, so they live per account rather
 * than globally.
 */

export type Account = {
  /** How a tool refers to this account. Lowercased. */
  name: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Filled in by auth_status once Google has told us. */
  email?: string;
};

export type Config = {
  accounts: Account[];
  /** Account names preferred, in order, when a tool is called without one. */
  preferred: string[];
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

type RawAccount = {
  name?: string;
  label?: string;
  email?: string;
  client_id?: string;
  clientId?: string;
  client_secret?: string;
  clientSecret?: string;
  refresh_token?: string;
  refreshToken?: string;
};

/**
 * Parse GOOGLE_PHOTOS_ACCOUNTS.
 *
 * Both snake_case and camelCase are accepted for every field, because the
 * value is hand-written into a JSON config and guessing wrong there produces
 * an account that silently does not load.
 */
function parseAccounts(raw: string | undefined): Account[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Loud, because the alternative is a server that starts with zero accounts
    // and reports "not configured" on every call.
    throw new Error(
      "GOOGLE_PHOTOS_ACCOUNTS is not valid JSON. It should be an array like " +
        '[{"name":"personal","client_id":"...","client_secret":"...","refresh_token":"..."}]',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("GOOGLE_PHOTOS_ACCOUNTS must be a JSON array of accounts.");
  }

  const accounts: Account[] = [];
  for (const [index, entry] of (parsed as RawAccount[]).entries()) {
    const clientId = cleanEnv(entry.client_id ?? entry.clientId);
    const clientSecret = cleanEnv(entry.client_secret ?? entry.clientSecret);
    const refreshToken = cleanEnv(entry.refresh_token ?? entry.refreshToken);
    const name = (entry.name ?? entry.label ?? entry.email ?? `account-${index + 1}`)
      .trim()
      .toLowerCase();

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        `GOOGLE_PHOTOS_ACCOUNTS entry "${name}" is missing client_id, client_secret or refresh_token.`,
      );
    }
    accounts.push({
      name,
      clientId,
      clientSecret,
      refreshToken,
      ...(entry.email ? { email: entry.email } : {}),
    });
  }
  return accounts;
}

export function loadConfig(): Config {
  const multi = parseAccounts(process.env.GOOGLE_PHOTOS_ACCOUNTS);

  const single: Account[] = (() => {
    if (multi.length > 0) return [];
    const clientId = cleanEnv(process.env.GOOGLE_PHOTOS_CLIENT_ID);
    const clientSecret = cleanEnv(process.env.GOOGLE_PHOTOS_CLIENT_SECRET);
    const refreshToken = cleanEnv(process.env.GOOGLE_PHOTOS_REFRESH_TOKEN);
    if (!clientId && !clientSecret && !refreshToken) return [];
    return [{ name: "default", clientId, clientSecret, refreshToken }];
  })();

  const preferred = (process.env.GOOGLE_PHOTOS_DEFAULT_ACCOUNT ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    accounts: [...multi, ...single],
    preferred,
    readOnly: envFlag("GOOGLE_PHOTOS_READ_ONLY", false),
    allowDestructive: envFlag("GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE", true),
    requestTimeoutMs: envInt("GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS", 30_000),
    maxRetries: envInt("GOOGLE_PHOTOS_MAX_RETRIES", 2),
    userAgent: `google-photos-mcp/1.0.0 (+https://github.com/navidmoazzez/google-photos-mcp)`,
    auditPath: process.env.GOOGLE_PHOTOS_AUDIT_LOG?.trim() || undefined,
    authPort: envInt("GOOGLE_PHOTOS_AUTH_PORT", DEFAULT_AUTH_PORT),
  };
}

/**
 * Which account acts, when a tool names one or does not.
 *
 * An exact name match beats a prefix match, deliberately. With accounts named
 * "navid" and "navid-brand", a pure prefix match on "navid" is ambiguous and
 * would send an upload to whichever happened to be first in the list. That is
 * the kind of bug nobody notices until photos are in the wrong library.
 */
export function selectAccount(config: Config, hint?: string): Account {
  if (config.accounts.length === 0) {
    throw new Error(
      "No Google Photos account is configured. Set GOOGLE_PHOTOS_CLIENT_ID, GOOGLE_PHOTOS_CLIENT_SECRET and GOOGLE_PHOTOS_REFRESH_TOKEN, or GOOGLE_PHOTOS_ACCOUNTS for several. Run `google-photos-mcp auth` to obtain a refresh token.",
    );
  }

  if (hint && hint.trim()) {
    const want = hint.trim().toLowerCase();
    const exact = config.accounts.find((a) => a.name === want || a.email?.toLowerCase() === want);
    if (exact) return exact;
    const partial = config.accounts.filter(
      (a) => a.name.startsWith(want) || a.email?.toLowerCase().startsWith(want),
    );
    if (partial.length === 1) return partial[0] as Account;
    if (partial.length > 1) {
      throw new Error(
        `"${hint}" matches more than one account (${partial.map((a) => a.name).join(", ")}). Name one exactly.`,
      );
    }
    throw new Error(
      `No account called "${hint}". Configured: ${config.accounts.map((a) => a.name).join(", ")}. Call list_accounts to see them.`,
    );
  }

  for (const name of config.preferred) {
    const match = config.accounts.find((a) => a.name === name);
    if (match) return match;
  }
  return config.accounts[0] as Account;
}

/** True when the server has at least one usable account. */
export function isConfigured(config: Config): boolean {
  return config.accounts.some((a) => a.clientId && a.clientSecret && a.refreshToken);
}

/** What is missing, phrased for someone reading it in a terminal. */
export function missingCredentials(config: Config): string[] {
  if (config.accounts.length === 0) {
    return ["GOOGLE_PHOTOS_CLIENT_ID", "GOOGLE_PHOTOS_CLIENT_SECRET", "GOOGLE_PHOTOS_REFRESH_TOKEN"];
  }
  const missing: string[] = [];
  for (const a of config.accounts) {
    const label = config.accounts.length > 1 ? `${a.name}: ` : "";
    if (!a.clientId) missing.push(`${label}GOOGLE_PHOTOS_CLIENT_ID`);
    if (!a.clientSecret) missing.push(`${label}GOOGLE_PHOTOS_CLIENT_SECRET`);
    if (!a.refreshToken) missing.push(`${label}GOOGLE_PHOTOS_REFRESH_TOKEN`);
  }
  return missing;
}
