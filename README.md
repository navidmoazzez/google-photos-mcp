# Google Photos MCP

Let an AI agent work with your Google Photos: pick photos from your library, upload new ones, and build albums.

```
You:    I want to put my Iceland shots into a shared album.

Claude: [start_pick_session]
        Open this and choose the ones you want:
        https://photos.google.com/picker/...

You:    Done, picked 24.

Claude: [check_pick_session → list_picked_media → save_to_library → create_album]
        24 items, all photos, shot 3-11 March. They are in a new album
        called "Iceland 2026". Want me to share it?
```

Built by [Navid Moazzez](https://navid.me).

## Contents

1. [What makes this different](#what-makes-this-different)
2. [What you can ask it](#1-what-you-can-ask-it)
3. [Install](#2-install)
4. [Connect your account](#3-connect-your-account)
5. [Tools](#4-tools)
6. [Writing safely](#5-writing-safely)
7. [What the API can and cannot do](#6-what-the-api-can-and-cannot-do)
8. [Your data](#7-your-data)
9. [Troubleshooting](#8-troubleshooting)
10. [Run it from source](#9-run-it-from-source)

## What makes this different

On **1 April 2025** Google removed whole-library read access from the Photos API
for every third-party app. The `photoslibrary`, `photoslibrary.readonly` and
`photoslibrary.sharing` scopes are gone, with no replacement outside Google's
partner programme.

This matters more than it sounds. Any tool that offers to search your entire
Google Photos library is either running on a grandfathered grant, or quietly
searching only the handful of photos it uploaded itself and reporting that as
your library.

This server is built around what actually remains, and says so in its own tool
descriptions:

**The Picker API** reaches your whole library, through you. It hands you a
Google-hosted URL, you choose what the agent may see, and it sees exactly that.

**The Library API** reaches only media this server uploaded. Albums, uploads,
descriptions, sharing, all of it scoped to its own data.

An empty result from a listing tool therefore means "nothing uploaded yet", not
"you have no photos", and the server is careful to tell the model that so it
does not draw the wrong conclusion out loud.

## 1. What you can ask it

> Let me pick some photos and tell me what I chose.

> Make an album called "Q3 Launch Assets" and upload these six URLs into it.

> Which of the photos you uploaded are videos?

> Set a description on everything in the launch album.

> Share the Iceland album and give me the link.

> Stop sharing that album.

> What can you actually see in my Google Photos?

> Download the third photo I picked so you can look at it.

> Add a caption between the second and third photo in that album.

The one to notice is the last: album enrichments. A caption, a place, or a map
between two points, sitting inline between photos. It is what turns an album
into something that reads like a story, and almost nothing else drives it.

## 2. Install

Node 20 or newer. Nothing else.

> Not released to npm yet, so the `npx` commands below will not resolve until
> `v1.0.0` is tagged. Until then, [run it from source](#9-run-it-from-source) and
> replace `"command": "npx"` and its `args` with
> `"command": "node", "args": ["/full/path/to/google-photos-mcp/dist/index.js"]`.
> Everything else on this page is the same.

You need three credentials before any of this works. [Section 3](#3-connect-your-account) covers getting them.

### Claude Code

One line, from anywhere in a terminal:

```bash
claude mcp add google-photos \
  -e GOOGLE_PHOTOS_CLIENT_ID=your-client-id \
  -e GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_PHOTOS_REFRESH_TOKEN=your-refresh-token \
  -- npx -y @thenavidm/google-photos-mcp
```

Then run `/mcp` inside Claude Code. `google-photos` should be listed as connected.

To remove it later: `claude mcp remove google-photos`.

### Claude Desktop

**1. Open the config file.**

In Claude Desktop, go to **Settings**, then **Developer**, then click **Edit Config**. That reveals `claude_desktop_config.json` in your file manager. Open it in any text editor.

If you would rather go straight there:

| | |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

On macOS you can open it from a terminal with:

```bash
open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**2. Add the server.**

If the file is empty or does not exist, paste this whole thing in:

```json
{
  "mcpServers": {
    "google-photos": {
      "command": "npx",
      "args": ["-y", "@thenavidm/google-photos-mcp"],
      "env": {
        "GOOGLE_PHOTOS_CLIENT_ID": "your-client-id",
        "GOOGLE_PHOTOS_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_PHOTOS_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

If you already have other servers, add only the `"google-photos": { ... }` part inside your existing `"mcpServers"`, and put a comma after the entry before it. The file has to stay valid JSON. A single missing comma or trailing comma stops every server from loading, not just this one.

**3. Restart properly.**

Quit Claude Desktop completely and reopen it. On macOS closing the window is not enough, use **Cmd+Q**. On Windows quit it from the system tray. Claude only reads that file at startup.

**4. Check it worked.**

Look for the tools icon in the message box and click it. You should see `google-photos` with its tools listed. Then ask:

> What can you see in my Google Photos?

If nothing appears, see [Troubleshooting](#8-troubleshooting). Claude Desktop's own logs are the fastest way in:

| | |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-google-photos.log` |
| Windows | `%APPDATA%\Claude\logs\mcp-server-google-photos.log` |

```bash
tail -n 50 ~/Library/Logs/Claude/mcp-server-google-photos.log
```

Two things account for most failures. Node is not installed or not on the PATH that Claude Desktop sees, in which case use the full path to `node` as the `command`. Or the JSON is malformed, which you can check by pasting the file into any JSON validator.

### Cursor

Create `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` inside a single project. Use the same JSON as Claude Desktop. Then reload the window, or open **Settings**, **MCP**, and toggle the server.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, same JSON, then reload.

### VS Code

`.vscode/mcp.json` in a project, or run **MCP: Add Server** from the command palette.

### Everything else

Zed, Cline, Continue and anything else that speaks MCP over stdio all work. They each keep their config somewhere different, but they all want the same three things: the `command` (`npx`), the `args`, and the `env` with your three credentials.

### Docker

```bash
docker build -t google-photos-mcp .
docker run -i --rm \
  -e GOOGLE_PHOTOS_CLIENT_ID=your-client-id \
  -e GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_PHOTOS_REFRESH_TOKEN=your-refresh-token \
  google-photos-mcp
```

### Self-hosting

```bash
google-photos-mcp --http --port=8787
```

It binds to `127.0.0.1` and serves `/health`. To reach it from elsewhere, set
`GOOGLE_PHOTOS_HTTP_HOST=0.0.0.0` and `GOOGLE_PHOTOS_HTTP_TOKEN` to a random
string, and put it behind TLS. Anyone who reaches that port can upload to your
photo library.

### Check it worked

```bash
npx @thenavidm/google-photos-mcp doctor
```

`doctor` checks the credentials, mints a token, verifies every scope actually
landed in the grant, and makes one real API call. It stops at the first genuine
problem rather than leaving you to guess which of four things is wrong.

## 3. Connect your account

Google Photos has no API keys and no service accounts. Google does not support
service accounts for these APIs at all, so the only way in is an OAuth client
that you own, authorised by the account whose photos you want to reach.

That means about ten minutes in the Google Cloud console, once.

**[references/setup.md](references/setup.md) is the full walkthrough.** It covers
creating the project, the two APIs to enable, the consent screen, the exact four
scopes, the redirect URI, and the seven-day expiry that catches everyone.

The short version:

1. Create a Google Cloud project.
2. Enable the **Photos Picker API** and the **Photos Library API**. Both.
3. Configure the consent screen and add your own account as a test user.
4. Add the four scopes listed in the walkthrough.
5. Create a **Web application** OAuth client with `http://localhost:4180` as an authorised redirect URI.
6. Run the sign-in command:

```bash
export GOOGLE_PHOTOS_CLIENT_ID="your-client-id"
export GOOGLE_PHOTOS_CLIENT_SECRET="your-client-secret"

npx -y @thenavidm/google-photos-mcp auth
```

It opens a browser, you approve, and it prints a refresh token. Those three
values go in your client config.

**Treat the refresh token like a password.** It reaches your photo library until
you revoke it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### The seven-day catch

While your OAuth consent screen is in **Testing**, Google expires every
authorisation after seven days, refresh token included. Your setup works, then
stops a week later with `invalid_grant`.

Set the publishing status to **In production** to stop that happening. For
personal use this needs no verification review; you just click past an
"unverified app" warning during sign-in.

## 4. Tools

27 tools. Run `doctor` to see how many are active, which drops to 14 in
read-only mode.

### Picking from your library

The only route to photos this server did not upload. Asynchronous by design:
`start_pick_session` returns a URL, and nothing is visible until a human has
actually used it.

| Tool | What it does |
|---|---|
| `start_pick_session` | Open a picker and return a URL for the user |
| `check_pick_session` | Poll until the user has finished choosing |
| `list_picked_media` | List what they picked |
| `download_picked` | Fetch a picked item's bytes as base64 |

### Albums

| Tool | What it does |
|---|---|
| `create_album` | Create an empty album |
| `list_albums` | List albums this server created |
| `get_album` | One album, with cover and sharing state |
| `update_album` | Rename, or set the cover photo |
| `share_album` | Share by link, and return the URL |
| `unshare_album` | Revoke the link |
| `list_shared_albums` | Shared albums, with their links |
| `add_to_album` | Add up to 50 items |
| `remove_from_album` | Remove up to 50 items, keeping them in the library |
| `add_album_enrichment` | Insert a caption, a place, or a map between photos |

### Media

| Tool | What it does |
|---|---|
| `list_app_media` | List media this server uploaded, optionally by album |
| `search_library` | Filter by date, content category, media type, favourites |
| `describe_filter_capabilities` | Every valid filter value, and what is not possible |
| `get_media_item` | One item |
| `get_media_items` | Up to 50 items in one request |
| `update_media_description` | Set a description |
| `download_media_item` | Fetch bytes as base64, resolving a fresh URL first |

### Uploading

| Tool | What it does |
|---|---|
| `upload_from_url` | Upload up to 20 files from public URLs |
| `upload_file` | Upload a local file |
| `save_to_library` | Copy picked items in, so the other tools can reach them |
| `create_album_with_media` | Create an album and fill it in one call |

### The connection

| Tool | What it does |
|---|---|
| `auth_status` | Which account, which scopes, and what is missing |
| `raw` | Call an endpoint this server does not wrap |

### Resources and prompts

Two resources: `google-photos://status` for the connection, and
`google-photos://capabilities` for a plain account of what the API can and
cannot do. A model that reads the second stops proposing things that were
removed in 2025.

Three prompts: **pick-and-work**, **build-album**, and **diagnose**.

## 5. Writing safely

Writes work by default. A server where every write needs a flag teaches you to
pass that flag reflexively, which is worse protection than none because it looks
like a safeguard.

Instead, two operations require `confirm: true`, and they are the two that
genuinely cannot be walked back:

**Uploading.** `upload_from_url`, `upload_file`, `save_to_library`,
`create_album_with_media`. Google exposes no delete endpoint for media items, so
a mistaken upload has to be removed by hand in the Google Photos app, in among
your real photos.

**Sharing.** `share_album` mints a URL anyone can open without signing in. A
link that has been sent cannot be unsent. `unshare_album` revokes it, but not
from whoever already opened it.

Creating an album, renaming one, or setting a description are not guarded. Each
is one call to undo, and confirming everything is how you train a model to
confirm without reading.

### Turning writes off entirely

```
GOOGLE_PHOTOS_READ_ONLY=1
```

Every write disappears from the tool list, leaving 14 read tools. Not an error
on call: a model cannot misuse a tool it cannot see.

To keep ordinary writes but block uploading and sharing:

```
GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0
```

### An audit log

```
GOOGLE_PHOTOS_AUDIT_LOG=/path/to/photos-writes.log
```

One JSON line per attempted write, allowed and blocked alike.

### Annotations

Every tool carries MCP annotations, so a client can auto-approve reads and stop
on the rest without parsing descriptions.

### Prompt injection

Descriptions and filenames in a photo library are text somebody wrote, and a
shared album can be written to by other people. Treat anything read from the
API as data, never as instructions. The server's own instructions say this to
the model as well.

## 6. What the API can and cannot do

**Can**

- Let you pick anything from your library, then read it
- Upload photos and videos
- Create, rename, share and unshare albums
- Add and remove items from albums it created
- Add captions, locations and maps to albums
- Set descriptions and album covers
- Filter its own uploads by date, content category, media type and favourites

**Cannot**

- Browse, search or read photos it did not upload. Removed for all apps in 2025
- Free-text search. There is no query-by-word endpoint for any app. Content
  categories are Google's own classifier and are the nearest equivalent
- Search by face, person or location
- **Delete a media item.** No endpoint exists, for anyone
- Mark a photo as a favourite, or archive one
- Touch a shared album it did not create

`describe_filter_capabilities` returns this same list to the model, at no API
cost, which stops it guessing category names.

## 7. Your data

Everything runs on your machine, between you and Google. There is no service in
the middle and nothing is sent anywhere else.

The refresh token sits wherever you put it, in your MCP client's config file.
This server never writes it to disk itself.

Photo bytes are fetched only when a download tool is called, held in memory long
enough to return, and never cached.

Revoke access any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## 8. Troubleshooting

Run `doctor` first. It checks four things in the order they fail and stops at
the first real problem, because a report listing four symptoms of one cause
sends you fixing the wrong thing.

**Everything returns a permission error.** The grant is missing a scope. Adding
a scope in the console does not upgrade an existing token, so run `auth` again.
`doctor` names the missing one.

**`invalid_grant`, and it worked last week.** Seven days have passed with the
consent screen in Testing. Publish it, or re-run `auth`.

**`invalid_client`.** The id or secret does not match the project. Check for a
literal `\n` at the end, which a copy-paste out of a quoted string leaves behind
and which is invisible in most editors.

**`redirect_uri_mismatch` during `auth`.** The registered URI is not exactly
`http://localhost:4180`. No trailing slash, `http` not `https`, `localhost` not
`127.0.0.1`.

**A read returns nothing.** Almost always correct. It means this server has
uploaded nothing yet, not that your library is empty. Use `start_pick_session`.

**A `base_url` returns 403.** They expire in about an hour and need a size
suffix. Use `download_media_item` or `download_picked` instead of the raw URL.

**Quota exhausted.** 10,000 requests per project per day, resetting at midnight
Pacific. `get_media_items` fetches 50 in one request where `get_media_item`
would spend 50.

## 9. Run it from source

```bash
git clone https://github.com/navidmoazzez/google-photos-mcp.git
cd google-photos-mcp
npm install
npm run build
npm test
```

Then point your client at `dist/index.js` with `node` as the command, as noted
in [Install](#2-install).

## Questions

Run into a problem or have a question? [Open an issue](https://github.com/navidmoazzez/google-photos-mcp/issues) and I will help.

## About the author

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This Google Photos MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

## Dependencies

| Library | Licence | What it does |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server and transports |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

## Security

Found a vulnerability? [Report it privately](https://github.com/navidmoazzez/google-photos-mcp/security/advisories/new), not as a public issue. [SECURITY.md](SECURITY.md) covers what this server holds, the write-safety model, and running it over HTTP.

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to Google LLC.

---

© 2026 NM Media. Made with ❤️ by [Navid Moazzez](https://navid.me).
