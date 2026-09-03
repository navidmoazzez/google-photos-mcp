# Versions

| Component | Version | Checked |
|---|---|---|
| MCP TypeScript SDK | ^1.18.0 | 2026-09-04 |
| zod | ^3.23.8 | 2026-09-04 |
| Node | >=20 | 2026-09-04 |
| Google Photos Picker API | v1 | 2026-09-04 |
| Google Photos Library API | v1 | 2026-09-04 |
| actions/checkout | v7 | 2026-09-04 |
| actions/setup-node | v7 | 2026-09-04 |

## 1.2.0

Renamed. The repository is now `google-photos-mcp-cli` and the package
`@thenavidm/google-photos-mcp-cli`, matching the two surfaces it actually ships.
The binaries are unchanged: `google-photos-mcp` and `google-photos-cli`.

**Removed the three sharing tools.** `share_album`, `unshare_album` and
`list_shared_albums` called `albums.share`, `albums.unshare` and `sharedAlbums`,
which Google removed on 31 March 2025 along with the `photoslibrary.sharing`
scope. Every one of them returned `403 PERMISSION_DENIED`, and this server never
requested the scope they needed in the first place. Google's own guidance is
that the user shares an album by hand in the Google Photos app. Three tools that
always failed are worse than three tools that are not there, so the tool count
drops from 29 to 26 and read-only mode from 16 to 15.

Four CLI adapter fixes:

- An enum inside an array is now a scalar flag, so `--categories LANDSCAPES` works rather than demanding `'"LANDSCAPES"'`
- "Nothing configured" is tested before authentication and only when there is no HTTP status, so it exits 10 rather than 4 while a real 401 still exits 4
- A write the guard refused exits 2, a usage error, rather than 5, an API error
- Confirmed the `auth`, `doctor` and `help` passthrough on the CLI binary still reaches the entry point rather than being rejected as an unknown command

**`--select` no longer drops fields.** Two paths sharing a head overwrote each
other, so `--select items.id,items.filename` returned the filename and said
nothing about the id it had thrown away. Silent data loss in the flag whose
entire purpose is choosing what you keep. Paths are now grouped by their first
segment before recursing, with three regression tests.

**`--version` reads package.json.** The version was written out in `server.ts`
and again in the User-Agent, so a release that bumped one and not the other left
`--version` and `doctor` answering for a build that was not running. Both now
read the running package.

Adds a Claude Desktop extension: `desktop-extension/`, built with
`npm run build:mcpb`, vendoring its own dependencies so it installs on a double
click and asking for the client id, secret and refresh token in the install
dialog.

The README now names both surfaces, shows runnable examples of each, and
publishes the measured context cost: 7,271 tokens of tool definitions plus 352
of server instructions, from a real `tools/list` handshake against this build.

## 1.1.0

Several Google accounts at once. `GOOGLE_PHOTOS_ACCOUNTS` takes a JSON array,
every scoped tool takes an optional `account`, and `list_accounts` shows what is
connected. An exact name beats a prefix when resolving, so two similar names
cannot silently resolve to the wrong library.

Fixes the FAQ, where a single newline rendered each question and its answer as
one run-on paragraph, and the npm `author` field, where the website was written
in angle brackets and published as an email address.

## 1.0.0

First release.

29 tools across both halves of the Google Photos API: the Picker API for
reaching the user's whole library through them, and the Library API for media
this server uploaded.

Built around what the API offers after Google removed whole-library read access
on 1 April 2025, rather than around what it used to offer. The tool
descriptions, the `google-photos://capabilities` resource and
`describe_filter_capabilities` all state the limits plainly, so a model reports
"this server has uploaded nothing" instead of "your library is empty".

- Picker flow: `start_pick_session`, `check_pick_session`, `list_picked_media`, `download_picked`
- Albums: create, list, get, update, share, unshare, list shared, add and remove items, enrichments
- Media: list, search, get one, get many, set description, download
- Uploads: from URL, from a local file, from a picker selection, or album and contents in one call
- Connection: `list_accounts`, `auth_status`, `quota_status`, and a `raw` escape hatch
- Several Google accounts at once via `GOOGLE_PHOTOS_ACCOUNTS`, with `account` on every scoped tool and an exact name beating a prefix so two similar names cannot resolve to the wrong library
- Both daily quotas tracked locally (10,000 API requests, 75,000 media-byte requests, midnight UTC) so the ceiling refuses before the call rather than returning a 429 a model reads as transient
- `google-photos-mcp auth` runs the one-time sign-in and prints a refresh token
- `google-photos-mcp doctor` checks credentials, scopes and a live API call, in the order they fail
- stdio and streamable HTTP transports
- `GOOGLE_PHOTOS_READ_ONLY=1` drops the tool list to the 16 reads
- Uploading and sharing require `confirm: true`, because Google exposes no delete endpoint and a share link cannot be recalled
