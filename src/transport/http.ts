/**
 * HTTP transport, for running the server somewhere always on.
 *
 * Streamable HTTP per the 2025-03-26 spec, stateless: every request builds its
 * own transport and tears it down. No session map means no session leak, which
 * matters far more than the reconnect support a stateful server would buy.
 *
 * Bound to 127.0.0.1 by default. An OAuth refresh token reaches a real photo library, so a
 * server that binds 0.0.0.0 without being asked is a mistake waiting to be made
 * once; GOOGLE_PHOTOS_HTTP_HOST is there for people who mean it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BuiltServer } from "../server.js";
import { isConfigured } from "../config.js";

export type HttpOptions = {
  port: number;
  host: string;
  /** When set, every request must send `Authorization: Bearer <token>`. */
  token?: string;
};

export function httpOptionsFromEnv(argv: string[] = []): HttpOptions {
  // Both spellings, and neither silently. `--port=8790` and `--port 8790` are
  // what people type; accepting only the first meant the second fell through to
  // the default with no complaint, which is indistinguishable from the flag
  // being ignored. A trailing `--port` with nothing after it, `--portable`, and
  // a non-positive number all fall back rather than producing NaN.
  const i = argv.findIndex((a) => a === "--port" || a.startsWith("--port="));
  const raw =
    i === -1
      ? undefined
      : (argv[i] as string).includes("=")
        ? (argv[i] as string).split("=").slice(1).join("=")
        : argv[i + 1];
  const fromFlag = raw === undefined ? NaN : Number(raw);
  const fromEnv = Number(process.env.GOOGLE_PHOTOS_HTTP_PORT);
  const port = Number.isFinite(fromFlag) && fromFlag > 0
    ? fromFlag
    : Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : 8787;
  return {
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    host: process.env.GOOGLE_PHOTOS_HTTP_HOST || "127.0.0.1",
    token: process.env.GOOGLE_PHOTOS_HTTP_TOKEN || undefined,
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function startHttpServer(
  built: BuiltServer,
  options: HttpOptions,
): Promise<{ close: () => Promise<void> }> {
  const http = createServer((req, res) => {
    void handle(built, options, req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: (error as Error)?.message ?? "internal error" },
          id: null,
        }),
      );
    });
  });

  await new Promise<void>((resolve) => http.listen(options.port, options.host, resolve));
  process.stderr.write(
    `[bluesky-mcp] listening on http://${options.host}:${options.port}/mcp${options.token ? " (bearer token required)" : ""}\n`,
  );

  return {
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
      }),
  };
}

async function handle(
  built: BuiltServer,
  options: HttpOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tools: built.toolCount, configured: isConfigured(built.config) }));
    return;
  }

  if (options.token) {
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${options.token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }

  if (req.method === "DELETE") {
    // Stateless: there is no session to end, and saying so beats a 404.
    res.writeHead(204).end();
    return;
  }

  // A fresh transport per request. `sessionIdGenerator: undefined` is what puts
  // the SDK in stateless mode.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => void transport.close());
  await built.server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}
