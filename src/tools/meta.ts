/**
 * Tools about the connection itself.
 *
 * `auth_status` exists because the most common failure is not a bug, it is a
 * grant that has quietly expired, and a model with no way to check that will
 * report the API as broken. `raw` exists because the Library API changes
 * faster than this server does.
 */

import { z } from "zod";
import { defineTool, accountArg, type AnyToolSpec } from "./kit.js";
import { SCOPES, isConfigured, missingCredentials } from "../config.js";

type TokenInfo = {
  scope?: string;
  expires_in?: number;
  email?: string;
  error_description?: string;
};

export const metaTools: AnyToolSpec[] = [
  defineTool({
    name: "list_accounts",
    title: "List the connected Google accounts",
    description:
      "Show every Google account this server can act as, and which one acts when a tool names none.\n\nPass one of these names as `account` on any tool to act as that library instead of the default. Costs no API call.",
    schema: {},
    risk: "read",
    handler: async (_args, ctx) => ({
      count: ctx.config.accounts.length,
      default: ctx.config.accounts.length > 0 ? ctx.account.name : null,
      accounts: ctx.config.accounts.map((a) => ({
        name: a.name,
        email: a.email ?? null,
        configured: Boolean(a.clientId && a.clientSecret && a.refreshToken),
      })),
      ...(ctx.config.accounts.length === 0
        ? { note: "Nothing configured. Set GOOGLE_PHOTOS_CLIENT_ID, GOOGLE_PHOTOS_CLIENT_SECRET and GOOGLE_PHOTOS_REFRESH_TOKEN, or GOOGLE_PHOTOS_ACCOUNTS for several." }
        : {}),
    }),
  }),

  defineTool({
    name: "auth_status",
    title: "Check the Google Photos connection",
    description:
      "Report whether the server can reach Google Photos, which account it acts as, and which scopes the grant actually carries.\n\nCall this first when anything returns a permission error. A missing scope and a revoked token produce similar-looking failures and are fixed differently.",
    schema: { ...accountArg },
    risk: "read",
    handler: async (_args, ctx) => {
      if (!isConfigured(ctx.config)) {
        return {
          connected: false,
          missing: missingCredentials(ctx.config),
          fix: "Set the missing variables in the MCP client config. Run `google-photos-mcp auth` to obtain a refresh token.",
        };
      }

      const token = await ctx.client.accessToken();
      // tokeninfo is the only way to see what a grant actually carries. A
      // refresh token minted before a scope was added keeps the old scope set
      // forever, and nothing else surfaces that.
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
      const info = (await response.json().catch(() => ({}))) as TokenInfo;

      const granted = (info.scope ?? "").split(/\s+/).filter(Boolean);
      const missingScopes = SCOPES.filter((s) => !granted.includes(s));

      return {
        connected: response.ok,
        account_name: ctx.account.name,
        account: info.email,
        access_token_expires_in_seconds: info.expires_in,
        granted_scopes: granted,
        ...(missingScopes.length > 0
          ? {
              missing_scopes: missingScopes,
              fix: "This grant predates a scope the server needs. Re-run `google-photos-mcp auth` and consent again; an existing refresh token is never upgraded in place.",
            }
          : {}),
        read_only_mode: ctx.config.readOnly,
      };
    },
  }),

  defineTool({
    name: "quota_status",
    title: "Check how much daily quota is left",
    description:
      "Report how much of the Google Cloud project's daily budget this server has spent: 10,000 API requests and 75,000 media-byte requests, both resetting at midnight UTC.\n\nCounted by this process since it started, so it is a floor rather than a true reading. Worth checking before a long batch, and worth reading when calls start failing with RESOURCE_EXHAUSTED.",
    schema: {},
    risk: "read",
    handler: async (_args, ctx) => ctx.client.quota.status(),
  }),

  defineTool({
    name: "raw",
    title: "Call a Google Photos endpoint directly",
    description:
      "Escape hatch for an endpoint this server does not wrap. Give a path relative to the API root and it is sent with the current access token.\n\nPrefer a named tool where one exists: they shape the response, handle pagination and explain their errors. Reach for this when the API has something the tools do not cover yet.",
    schema: {
      api: z
        .enum(["library", "picker"])
        .describe("Which host: 'library' for photoslibrary.googleapis.com/v1, 'picker' for photospicker.googleapis.com/v1."),
      path: z.string().describe("Path under the v1 root, starting with a slash. For example '/albums'."),
      method: z.enum(["GET", "POST", "PATCH", "DELETE"]).optional().describe("HTTP method. Default GET."),
      body: z.record(z.unknown()).optional().describe("JSON body, for POST and PATCH."),
      query: z.record(z.string()).optional().describe("Query string parameters."),
      ...accountArg,
    },
    risk: "write",
    summary: (args) => `${args.method ?? "GET"} ${args.api}${args.path}`,
    handler: async (args, ctx) =>
      ctx.client.request(args.api, args.path.startsWith("/") ? args.path : `/${args.path}`, {
        method: args.method ?? "GET",
        ...(args.body ? { body: args.body } : {}),
        ...(args.query ? { query: args.query } : {}),
      }),
  }),
];
