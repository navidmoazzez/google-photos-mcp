/**
 * Assembling the server.
 *
 * Tools, plus the two things most MCP servers skip and clients genuinely use:
 * resources, so a client can pull the context it needs without spending a tool
 * call, and prompts, so the workflows this server is good at are one click
 * rather than something the user has to know to ask for.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PhotosClient } from "./api/client.js";
import { loadConfig, isConfigured, type Config } from "./config.js";
import { WriteGuard } from "./safety.js";
import { ALL_TOOLS } from "./tools/index.js";
import { makeContext, register } from "./tools/kit.js";

export const VERSION = "1.0.0";

export const INSTRUCTIONS = `Tools for Google Photos: picking photos from the user's library, uploading, and organising albums.

Five things worth knowing before calling anything:

1. This API is smaller than it looks, and the reason is a policy change, not a bug. On 2025-04-01 Google removed whole-library read access for every third-party app. Nothing here can browse, search or read the user's existing photos.

2. There are two halves. The Picker API reaches the user's whole library, but only through them: start_pick_session returns a URL, the user opens it and chooses, then check_pick_session and list_picked_media report what they picked. The Library API reaches only media this app itself uploaded, and everything else here operates on that.

3. Because of 2, an empty result from list_app_media or search_library means "this app has uploaded nothing", not "the user has no photos". Do not report it as an empty library. If the user wants you to work with an existing photo, start a picker session.

4. Uploading cannot be undone. Google exposes no delete, so a mistaken upload has to be removed by hand in the Google Photos app. upload_from_url, upload_file, save_to_library, create_album_with_media and share_album all refuse to run without confirm: true. Pass it when the user has actually asked for that action, not to get past the refusal.

5. A base_url is not a permanent link. It expires in about an hour and needs a size suffix. Use download_media_item or download_picked instead of handing one to the user.

Start with auth_status to confirm the connection, describe_filter_capabilities before searching, or start_pick_session when the user wants to work with a photo they already have.`;

export type BuiltServer = {
  server: McpServer;
  client: PhotosClient;
  config: Config;
  toolCount: number;
};

export function buildServer(config: Config = loadConfig()): BuiltServer {
  const client = new PhotosClient(config);
  const guard = new WriteGuard(config);
  const ctx = makeContext(client, config, guard);

  const server = new McpServer({ name: "google-photos", version: VERSION }, { instructions: INSTRUCTIONS });

  // A read-only server should not advertise writes it will refuse.
  const tools = ALL_TOOLS.filter((tool) => !guard.readOnly || tool.risk === "read");
  for (const tool of tools) {
    register(server, () => ctx, tool);
  }

  registerResources(server, config);
  registerPrompts(server);

  return { server, client, config, toolCount: tools.length };
}

/**
 * Resources: the context a model needs about Google Photos itself.
 *
 * The scope situation is the single thing most likely to make a model draw a
 * wrong conclusion, so it gets a resource rather than living only in a tool
 * description a model may never read.
 */
function registerResources(server: McpServer, config: Config): void {
  server.resource("google-photos-status", "google-photos://status", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          { configured: isConfigured(config), read_only: config.readOnly, version: VERSION },
          null,
          2,
        ),
      },
    ],
  }));

  server.resource("google-photos-capabilities", "google-photos://capabilities", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: `# What the Google Photos API can and cannot do

## The 2025 change, and why this matters
On **1 April 2025** Google removed \`photoslibrary\`, \`photoslibrary.readonly\` and
\`photoslibrary.sharing\` from the scopes a third-party app may request. There is no
replacement and no appeal short of Google's partner programme. An app created today
cannot read a user's photo library.

This is not a limitation of this server. Any tool claiming to search someone's whole
Google Photos library is either using a grandfathered grant or reading only what it
uploaded itself.

## The two halves

**Picker API.** The user opens a Google-hosted picker, selects items, and the app sees
exactly those. Full library reach, user-mediated, per session. Selections are readable
only while the session lives.

**Library API, app-created data only.** Upload media, make albums, organise, describe,
share. Every read is filtered to what this app created.

## Can
- Let the user pick anything from their library, then read it
- Upload photos and videos
- Create, rename, share and unshare albums
- Add and remove items from albums this app made
- Add captions, locations and maps to albums
- Set descriptions and album covers
- Filter app-created media by date, content category, media type and favourites

## Cannot
- Browse, search or read photos the app did not upload
- Free-text search. There is no query-by-word endpoint, for any app. Content categories
  are Google's own classifier and are the closest thing
- Search by face, person or location
- **Delete a media item.** No endpoint exists. An upload is permanent as far as any API
  is concerned; the user removes it by hand
- Mark a photo as a favourite, or archive one
- Read or write anyone's shared album that this app did not create

## Practical consequences
- An empty listing means "this app uploaded nothing", never "the user has no photos"
- To operate on an existing photo, pick it, then \`save_to_library\` to make an
  app-owned copy the other tools can reach. This does leave two copies
- \`base_url\` expires in ~60 minutes and needs a size suffix (\`=d\`, \`=w2048-h2048\`,
  \`=dv\` for video). It is not a shareable link
- Quota is two separate daily budgets per Google Cloud project, both resetting at midnight
  UTC: 10,000 API requests, and 75,000 media-byte requests. Fetching a photo's bytes spends
  the second, not the first`,
      },
    ],
  }));
}

/** Prompts: the workflows worth having one click away. */
function registerPrompts(server: McpServer): void {
  server.prompt("pick-and-work", "Have the user choose photos, then do something with them", () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to work with some photos from my Google Photos library.

1. Call start_pick_session and give me the picker_uri. Then stop and wait for me.
2. Once I say I am done, poll check_pick_session until ready is true.
3. Call list_picked_media and tell me what I chose: how many, what kind, when they were taken.

Then ask me what I want done with them before doing anything else. Do not upload, copy or share anything until I have said so.`,
        },
      },
    ],
  }));

  server.prompt("build-album", "Create an album from a set of image URLs", () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Help me build a Google Photos album.

Ask me for the album title and the image URLs if I have not given them.

Before uploading anything, show me the exact list you are about to upload and how many there are, and wait for me to confirm. Uploading cannot be undone through the API: there is no delete endpoint, so anything wrong has to be removed by hand.

Once I confirm, use create_album_with_media so a failed upload does not leave an empty album behind. Report anything that failed and why, rather than only the successes.`,
        },
      },
    ],
  }));

  server.prompt("diagnose", "Work out why Google Photos is not responding", () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Something is wrong with my Google Photos connection. Work out what.

1. auth_status. Report which account it is, and whether any scope is missing.
2. If it is connected, list_albums with limit 1 to confirm a real call succeeds.
3. Read the google-photos://capabilities resource before concluding anything is broken.

Be careful to distinguish three different things: a genuine failure, a grant that needs re-consenting, and the API simply not offering what was asked for. An empty result is usually the third. Tell me which of the three it is and the one thing I should do next.`,
        },
      },
    ],
  }));
}
