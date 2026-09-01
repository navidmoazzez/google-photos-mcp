/**
 * Shared plumbing every tool uses.
 *
 * Registering twenty-six tools by hand is twenty-six chances to forget an
 * annotation, leak a stack trace, or return a shape the model cannot read.
 * This wraps all of it once so a tool module only describes what it does.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import type { PhotosClient } from "../api/client.js";
import type { ClientPool } from "../api/pool.js";
import { AuthError, PhotosError, WriteBlockedError } from "../api/errors.js";
import { selectAccount, type Account, type Config } from "../config.js";
import { annotationsFor, type Risk, type WriteGuard } from "../safety.js";

export type ToolContext = {
  /** Already bound to the account this call names, or the default one. */
  client: PhotosClient;
  account: Account;
  config: Config;
  guard: WriteGuard;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/**
 * Errors come back as a normal result with `isError`, not a thrown exception.
 *
 * A thrown MCP error reaches the model as a protocol failure with no
 * structure. A result it can read tells it what went wrong and usually how to
 * fix it, which is the difference between a correct retry and a give-up.
 */
export function fail(error: unknown): ToolResult {
  const payload =
    error instanceof PhotosError || error instanceof AuthError || error instanceof WriteBlockedError
      ? error.toJSON()
      : { error: (error as Error)?.message ?? String(error) };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}

/** The optional argument that picks an account, on every account-scoped tool. */
export const accountArg = {
  account: z
    .string()
    .optional()
    .describe(
      "Which connected Google account to act as, by the name it was configured under (or its email). Defaults to the first one. Call list_accounts to see them.",
    ),
};

/** The confirmation argument required by every irreversible tool. */
export const confirmArg = {
  confirm: z
    .boolean()
    .default(false)
    .describe(
      "Must be true for this to run. The effect cannot be undone through the API, so it is refused without an explicit confirmation.",
    ),
};

/** Page size and cursor, on every paginating tool. */
export const pageArgs = {
  limit: z.number().int().min(1).max(100).optional().describe("How many to return per page, 1-100."),
  page_token: z
    .string()
    .optional()
    .describe(
      "Continue from a previous page. Pass the `next_page_token` from the last result. Omit for the first page.",
    ),
};

export type ToolSpec<S extends ZodRawShape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  /** True when the effect is visible to anyone but the account owner. */
  public?: boolean;
  /** True when calling twice has the same effect as calling once. */
  idempotent?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log and the confirm message, when this is a write. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export function defineTool<S extends ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

/**
 * A tool of any shape, for the one place tools are held together in a list.
 *
 * `ToolSpec` is generic over its schema, so a list of tools with different
 * schemas has no single type: each handler takes a different argument shape
 * and function parameters are contravariant. The type safety that matters
 * lives inside each `defineTool` call, where schema and handler are checked
 * against each other. This only loosens the seam where they are collected.
 */
export type AnyToolSpec = Omit<ToolSpec<ZodRawShape>, "handler" | "summary"> & {
  handler: (args: never, ctx: ToolContext) => Promise<unknown>;
  summary?: (args: never) => string;
};

export function register(
  server: McpServer,
  contextFor: (accountHint?: string) => ToolContext,
  spec: AnyToolSpec,
): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.schema,
      annotations: {
        title: spec.title,
        ...annotationsFor(spec.risk, { public: spec.public, idempotent: spec.idempotent }),
      },
    },
    // The SDK derives its callback type from the schema generic. This wrapper
    // is generic over the same shape, but TypeScript cannot prove the two are
    // equal through the indirection, so the cast lives at this single boundary
    // rather than in every tool definition.
    (async (args: Record<string, unknown>) => {
      try {
        const ctx = contextFor((args as { account?: string }).account);
        if (spec.risk !== "read") {
          const summary = spec.summary?.(args as never) ?? spec.name;
          const confirm = (args as { confirm?: boolean }).confirm;
          ctx.guard.check(spec.name, spec.risk, confirm, summary);
        }
        return ok(await spec.handler(args as never, ctx));
      } catch (error) {
        return fail(error);
      }
    }) as never,
  );
}

/**
 * Resolved lazily, on first access.
 *
 * describe_filter_capabilities and quota_status answer without touching the
 * API, and they have to keep working when no account is configured at all.
 * Resolving eagerly would make them throw "no account configured", which is
 * both wrong and the least helpful moment to say it.
 */
export function makeContext(
  pool: ClientPool,
  hint: string | undefined,
  config: Config,
  guard: WriteGuard,
): ToolContext {
  return {
    get client(): PhotosClient {
      return pool.for(hint);
    },
    get account(): Account {
      return selectAccount(config, hint);
    },
    config,
    guard,
  };
}

/** Clamp a caller-supplied limit into a range the API will accept. */
export function clamp(value: number | undefined, fallback: number, max = 100): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
