/**
 * Errors the model can act on.
 *
 * Google's error bodies are consistent but verbose, and the important part is
 * usually one `status` enum buried three levels down. A model that receives
 * "PERMISSION_DENIED" plus the sentence explaining which scope is missing
 * retries correctly. One that receives a 300-line JSON dump gives up.
 */

export class PhotosError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly hint?: string;

  constructor(message: string, status: number, reason: string, hint?: string) {
    super(message);
    this.name = "PhotosError";
    this.status = status;
    this.reason = reason;
    if (hint) this.hint = hint;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      status: this.status,
      reason: this.reason,
      ...(this.hint ? { hint: this.hint } : {}),
    };
  }
}

export class WriteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteBlockedError";
  }

  toJSON(): Record<string, unknown> {
    return { error: this.message, reason: "BLOCKED_BY_SAFETY_SETTING" };
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }

  toJSON(): Record<string, unknown> {
    return { error: this.message, reason: "NOT_AUTHENTICATED" };
  }
}

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: unknown[];
  };
};

/**
 * The hints below exist because each of these failures has a specific cause
 * that the raw message does not name, and every one of them cost real time to
 * diagnose the first time.
 */
function hintFor(status: number, reason: string, message: string): string | undefined {
  if (reason === "PERMISSION_DENIED" || status === 403) {
    if (/insufficient|scope/i.test(message)) {
      return "The grant is missing a scope this call needs. Re-run `google-photos-mcp auth` to consent again; a refresh token only carries the scopes it was minted with.";
    }
    return "Google removed whole-library read access on 2025-04-01. The Library API now only returns media this app itself uploaded. To reach anything else in the library, use start_pick_session and let the user choose it.";
  }
  if (status === 401) {
    return "The access token was rejected. Usually the refresh token was revoked, or the OAuth consent screen is in Testing mode, where refresh tokens expire after 7 days. Re-run `google-photos-mcp auth`.";
  }
  if (status === 429 || reason === "RESOURCE_EXHAUSTED") {
    return "Google Photos API quota is exhausted. The default is 10,000 requests per project per day and it resets at midnight UTC.";
  }
  if (status === 404 || reason === "NOT_FOUND") {
    return "Either the id is wrong, or it names something this app did not create. The Library API cannot see media or albums created by anyone else, including the user.";
  }
  return undefined;
}

export async function toPhotosError(response: Response, context: string): Promise<PhotosError> {
  let body: GoogleErrorBody = {};
  let raw = "";
  try {
    raw = await response.text();
    body = JSON.parse(raw) as GoogleErrorBody;
  } catch {
    /* A non-JSON body is still worth surfacing, truncated. */
  }

  const message = body.error?.message || raw.slice(0, 300) || response.statusText || "Request failed";
  const reason = body.error?.status || `HTTP_${response.status}`;

  return new PhotosError(
    `${context}: ${message}`,
    response.status,
    reason,
    hintFor(response.status, reason, message),
  );
}
