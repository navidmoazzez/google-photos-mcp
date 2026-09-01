/**
 * Turning a refresh token into a usable access token, and minting the refresh
 * token in the first place.
 *
 * The mint happens once, interactively, via `google-photos-mcp auth`. It runs a
 * throwaway HTTP listener on localhost, opens the consent screen, catches the
 * redirect, and prints the refresh token for the user to paste into their
 * client config. A loopback redirect is used rather than the out-of-band copy
 * flow because Google shut that flow down; loopback is the supported path for
 * a locally installed app.
 */

import { createServer } from "node:http";
import { AuthError } from "./errors.js";
import { SCOPES, type Account } from "../config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

/**
 * Caches the access token until shortly before it expires.
 *
 * Google issues roughly one-hour tokens. Refreshing on every call would add a
 * round trip to every single tool and burn quota for nothing, so the token is
 * held and renewed 2 minutes early. The margin covers clock skew and a slow
 * request that started while the token was still technically valid.
 */
export class TokenStore {
  private readonly account: Account;
  private token = "";
  private expiresAt = 0;
  private inFlight: Promise<string> | null = null;

  constructor(account: Account) {
    this.account = account;
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    // Several tools can race here on the first call of a session. Sharing one
    // in-flight refresh avoids sending N identical requests and having Google
    // rate-limit the lot.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async refresh(): Promise<string> {
    const { clientId, clientSecret, refreshToken, name } = this.account;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new AuthError(
        `Account "${name}" is not fully configured. It needs a client id, a client secret and a refresh token. Run \`google-photos-mcp auth\` to obtain one, or \`google-photos-mcp doctor\` to see what is missing.`,
      );
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const data = (await response.json().catch(() => ({}))) as TokenResponse;

    if (!response.ok || !data.access_token) {
      const detail = data.error_description || data.error || `HTTP ${response.status}`;
      throw new AuthError(
        `Could not refresh the access token for account "${name}" (${detail}). ` +
          (data.error === "invalid_grant"
            ? "invalid_grant almost always means the refresh token was revoked or expired. An OAuth consent screen still in Testing mode expires refresh tokens after 7 days; publish it, or re-run `google-photos-mcp auth`."
            : data.error === "invalid_client"
              ? "invalid_client means the client id or secret does not match the project. Check for a stray newline in the value."
              : "Re-run `google-photos-mcp auth`."),
      );
    }

    this.token = data.access_token;
    this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 120_000;
    return this.token;
  }
}

/** The consent URL for the interactive flow. */
export function authorizeUrl(clientId: string, redirectUri: string): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // Without both of these Google returns an access token and no refresh
    // token on a repeat authorisation, and the flow silently produces nothing
    // usable for a user who has consented before.
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${query.toString()}`;
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    throw new AuthError(
      `Token exchange failed: ${data.error_description || data.error || `HTTP ${response.status}`}`,
    );
  }
  return data;
}

/**
 * Run the one-time consent flow and return the refresh token.
 *
 * Resolves only once Google has redirected back, so the caller can print the
 * result and exit.
 */
export function runAuthFlow(
  clientId: string,
  clientSecret: string,
  port: number,
  onUrl: (url: string) => void,
): Promise<TokenResponse> {
  const redirectUri = `http://localhost:${port}`;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      const done = (body: string, then: () => void): void => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>google-photos-mcp</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem">
${body}</body>`);
        // Close after the response has flushed, or the browser shows a
        // connection reset instead of the page telling the user they are done.
        res.on("finish", () => server.close(then));
      };

      if (error) {
        done(
          `<h1>Authorisation refused</h1><p>Google returned <code>${error}</code>. Nothing was saved. You can close this tab and try again.</p>`,
          () => reject(new AuthError(`Authorisation refused: ${error}`)),
        );
        return;
      }
      if (!code) {
        res.writeHead(404).end();
        return;
      }

      exchangeCode(code, clientId, clientSecret, redirectUri).then(
        (tokens) =>
          done(
            `<h1>Connected</h1><p>Your refresh token has been printed in the terminal. Close this tab and go back there.</p>`,
            () => resolve(tokens),
          ),
        (err: unknown) =>
          done(
            `<h1>Could not complete sign-in</h1><p>${(err as Error).message}</p>`,
            () => reject(err),
          ),
      );
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new AuthError(
              `Port ${port} is already in use. Set GOOGLE_PHOTOS_AUTH_PORT to a free port, and register http://localhost:<that port> as an authorised redirect URI first.`,
            )
          : err,
      );
    });

    server.listen(port, "127.0.0.1", () => onUrl(authorizeUrl(clientId, redirectUri)));
  });
}
