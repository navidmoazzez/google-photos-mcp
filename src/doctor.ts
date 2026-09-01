/**
 * `google-photos-mcp doctor`
 *
 * The setup has four independent things that can be wrong, and they produce
 * similar symptoms from inside an MCP client, where stderr is usually hidden.
 * This checks them in the order they fail and stops at the first one, because
 * a report listing four problems when the second is caused by the first sends
 * people fixing the wrong thing.
 */

import { buildServer } from "./server.js";
import { loadConfig, isConfigured, missingCredentials, SCOPES } from "./config.js";
import { PhotosClient } from "./api/client.js";

const ok = (msg: string): void => { process.stdout.write(`  ok    ${msg}\n`); };
const bad = (msg: string): void => { process.stdout.write(`  FAIL  ${msg}\n`); };
const info = (msg: string): void => { process.stdout.write(`        ${msg}\n`); };

export async function runDoctor(): Promise<number> {
  const config = loadConfig();
  process.stdout.write(`\ngoogle-photos-mcp doctor\n\n`);

  // 1. Credentials present.
  if (!isConfigured(config)) {
    bad(`Missing: ${missingCredentials(config).join(", ")}`);
    info("");
    info("GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET come from a Google");
    info("Cloud project you create. references/setup.md walks through it.");
    info("GOOGLE_PHOTOS_REFRESH_TOKEN comes from `google-photos-mcp auth`.");
    return 1;
  }
  ok("All three credentials are set");

  // 2. The refresh token actually mints an access token.
  const client = new PhotosClient(config);
  let token: string;
  try {
    token = await client.accessToken();
    ok("Refresh token works, access token minted");
  } catch (error) {
    bad((error as Error).message);
    return 1;
  }

  // 3. The grant carries every scope the tools need. A token minted before a
  //    scope was added keeps the old set forever, and the resulting 403s name
  //    the endpoint rather than the missing consent.
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
    );
    const data = (await response.json()) as { scope?: string; email?: string };
    const granted = (data.scope ?? "").split(/\s+/).filter(Boolean);
    const missing = SCOPES.filter((s) => !granted.includes(s));

    if (data.email) ok(`Connected as ${data.email}`);
    if (missing.length > 0) {
      bad(`The grant is missing ${missing.length} scope(s):`);
      for (const scope of missing) info(`  ${scope}`);
      info("");
      info("Re-run `google-photos-mcp auth`. An existing refresh token is never");
      info("upgraded in place; consenting again is the only way to add a scope.");
      return 1;
    }
    ok(`All ${SCOPES.length} scopes granted`);
  } catch {
    info("Could not read token info; skipping the scope check.");
  }

  // 4. A real API call, not just a token check.
  try {
    await client.request("library", "/albums", { query: { pageSize: 1 } });
    ok("Google Photos API reachable");
  } catch (error) {
    bad((error as Error).message);
    return 1;
  }

  const built = buildServer(config);
  ok(`${built.toolCount} tools registered${config.readOnly ? " (read-only mode: writes hidden)" : ""}`);

  if (config.auditPath) info(`Audit log: ${config.auditPath}`);
  process.stdout.write(`\nReady.\n\n`);
  return 0;
}
