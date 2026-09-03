#!/usr/bin/env node
/**
 * Entry point.
 *
 * `google-photos-mcp`             stdio, which is what MCP clients launch
 * `google-photos-mcp --http`      HTTP, for running it somewhere always on
 * `google-photos-mcp auth`        one-time sign-in, prints a refresh token
 * `google-photos-mcp doctor`      check the setup and say what is wrong
 * `google-photos-cli`             the same tools as shell commands
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, VERSION } from "./server.js";
import { loadConfig, isConfigured, missingCredentials, cleanEnv } from "./config.js";
import { httpOptionsFromEnv, startHttpServer } from "./transport/http.js";
import { runCli, isCliCommand } from "./cli.js";

const HELP = `google-photos-mcp ${VERSION}

  google-photos-mcp                     Run over stdio. This is what an MCP client launches.
  google-photos-mcp --http [--port=N]   Run over HTTP, for a machine that is always on.
  google-photos-mcp auth                Sign in once and print a refresh token.
  google-photos-mcp doctor              Check the setup and report what is wrong.
  google-photos-mcp --version           Print the version.
  google-photos-cli                     The same tools as shell commands.
  google-photos-cli <command> --help    What one command takes.

Credentials, all three required:
  GOOGLE_PHOTOS_CLIENT_ID          OAuth client id from your Google Cloud project
  GOOGLE_PHOTOS_CLIENT_SECRET      the matching client secret
  GOOGLE_PHOTOS_REFRESH_TOKEN      from \`google-photos-mcp auth\`

Or, for several Google accounts at once:
  GOOGLE_PHOTOS_ACCOUNTS           JSON array, replaces the three above
  GOOGLE_PHOTOS_DEFAULT_ACCOUNT    which one acts when a tool names none

Options:
  GOOGLE_PHOTOS_READ_ONLY=1             hide every write from the tool list
  GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0     keep writes, block uploading and sharing
  GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS      per-request deadline, default 30000
  GOOGLE_PHOTOS_MAX_RETRIES             retries on 429 and 5xx, default 2
  GOOGLE_PHOTOS_AUDIT_LOG               append-only log of every attempted write
  GOOGLE_PHOTOS_AUTH_PORT               loopback port for \`auth\`, default 4180
  GOOGLE_PHOTOS_HTTP_PORT / _HOST / _TOKEN  for --http

Setting up the Google Cloud project takes about ten minutes and is the only
fiddly part. The walkthrough is in the README, section 3.

https://github.com/thenavidm/google-photos-mcp
`;

async function runAuth(): Promise<number> {
  const config = loadConfig();
  // Read the client straight from the environment rather than from a
  // configured account. `auth` runs before any account exists, which is the
  // whole point of it, so there is nothing in config.accounts to read yet.
  const clientId = cleanEnv(process.env.GOOGLE_PHOTOS_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.GOOGLE_PHOTOS_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    process.stderr.write(
      `Set GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET first. Both come from your own Google Cloud project; the README section 3 walks through creating one.\n`,
    );
    return 1;
  }

  const { runAuthFlow } = await import("./api/auth.js");
  const redirect = `http://localhost:${config.authPort}`;

  try {
    const tokens = await runAuthFlow(clientId, clientSecret, config.authPort, (url) => {
      process.stdout.write(
        `\nOpen this in a browser and sign in as the Google account whose photos you want to reach:\n\n${url}\n\nWaiting for the redirect on ${redirect} ...\n`,
      );
      // Best effort. On a headless box there is no browser and the printed
      // URL above is the whole interface, which is why it is printed first.
      void import("node:child_process").then(({ spawn }) => {
        const opener =
          process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        try {
          spawn(opener, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
        } catch {
          /* the URL is already on screen */
        }
      });
    });

    if (!tokens.refresh_token) {
      process.stderr.write(
        `\nGoogle returned no refresh token. That happens when this account has already consented to this client. Remove the app at https://myaccount.google.com/permissions and run \`google-photos-mcp auth\` again.\n`,
      );
      return 1;
    }

    process.stdout.write(
      `\nDone. Add this to your MCP client config:\n\n  "GOOGLE_PHOTOS_REFRESH_TOKEN": "${tokens.refresh_token}"\n\nTreat it like a password: it reaches the photo library until it is revoked.\n\nIf your OAuth consent screen is still in Testing mode, this token stops working after 7 days. Publishing the app fixes that.\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`\n${(error as Error).message}\n`);
    return 1;
  }
}

/**
 * One entry point, two programs. `google-photos-mcp` is the server and must stay
 * silent on stdout; `google-photos-cli` is the one a person types. Running the CLI
 * binary with no arguments is someone asking what they can type, so it lists
 * the commands rather than hanging on a transport that will never speak.
 */
function invokedAsCli(): boolean {
  const name = (process.argv[1] ?? "").split("/").pop() ?? "";
  return name.startsWith("google-photos-cli");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (invokedAsCli() && argv.length === 0) {
    process.exitCode = await runCli(["tools"]);
    return;
  }

  // Checked before --help and --version so `<tool> --help` reaches the tool.
  // A bare `--help` starts with a dash, so it falls through to the block below.
  if (isCliCommand(argv)) {
    process.exitCode = await runCli(argv);
    return;
  }

  // An unknown word used to fall through and start the server, which then sat
  // waiting on stdin: a typo looked like a hang, and scripts saw exit code 0.
  // `auth`, `doctor` and `help` are not tools but are still real commands, and
  // the OAuth setup is the first thing anyone runs, so they pass through.
  const shared = new Set(["auth", "doctor", "help"]);
  if (invokedAsCli() && command !== undefined && !command.startsWith("-") && !shared.has(command)) {
    process.stderr.write(
      `${JSON.stringify({ error: `Unknown command '${command}'. Run \`google-photos-cli\` to list them.` }, null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "auth") {
    process.exitCode = await runAuth();
    return;
  }
  if (command === "doctor") {
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor();
    return;
  }

  const config = loadConfig();
  const built = buildServer(config);

  // Warn, never block. A network check at startup would delay the handshake,
  // and the failure is more actionable on the tool call that hits it.
  if (!isConfigured(config)) {
    process.stderr.write(
      `[google-photos-mcp] Not configured: missing ${missingCredentials(config).join(", ")}. Every tool will report this. Run \`google-photos-mcp doctor\` for details.\n`,
    );
  }

  const shutdown = async (close?: () => Promise<void>): Promise<void> => {
    if (close) await close().catch(() => undefined);
    process.exit(0);
  };

  if (argv.includes("--http")) {
    const { close } = await startHttpServer(built, httpOptionsFromEnv(argv));
    process.on("SIGTERM", () => void shutdown(close));
    process.on("SIGINT", () => void shutdown(close));
    return;
  }

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // Handled so `docker stop` and a client shutting down return promptly rather
  // than waiting out a grace period.
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`[google-photos-mcp] ${(error as Error).message}\n`);
  process.exit(1);
});
