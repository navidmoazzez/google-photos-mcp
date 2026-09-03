<img src="https://cdn.navid.media/connectors/google-photos-icon.png" alt="Google Photos" width="88">

# Google Photos MCP Server & CLI

[![npm](https://img.shields.io/npm/v/@thenavidm%2Fgoogle-photos-mcp-cli?color=orange&label=npm)](https://www.npmjs.com/package/@thenavidm/google-photos-mcp-cli)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/thenavidm/google-photos-mcp-cli/ci.yml?branch=main&label=CI)](https://github.com/thenavidm/google-photos-mcp-cli/actions)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-thenavidm-0A66C2?logo=linkedin&logoColor=white)](https://linkedin.com/in/thenavidm)

Google Photos MCP server and CLI for Claude Code and AI agents. 26 tools for the photo picker, uploads, albums, enrichments, descriptions and app-created media.

One install gives you both surfaces, the same tools under the same names.

It opens Google's own picker, so you choose exactly what the agent sees. It
uploads photos and videos, builds albums, writes captions, and adds the
enrichments that make an album read as a story.

Google removed whole-library read access for every third-party app on 31 March
2025. Asking you to choose is the only route left, so this is built around the
picker rather than pretending otherwise.

Connect as many Google accounts as you need.

Built and maintained by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=google-photos-mcp-cli).

<img src="https://cdn.navid.media/repos/google-photos-mcp.gif?v=1" alt="Claude Code using the Google Photos MCP server" width="520">

## Two ways to use it

### Command line

`google-photos-cli` in your terminal, for scripting, cron, pipes, or a quick
question without opening anything:

```bash
google-photos-cli                                       # every command, one line each
google-photos-cli start-pick-session                    # hand yourself a picker URL
google-photos-cli check-pick-session --session-id abc   # have you finished picking?
google-photos-cli list-picked-media --session-id abc
google-photos-cli list-albums --json | jq -r '.items[].title'
google-photos-cli create-album --title "Q3 Launch"
google-photos-cli upload-file --path ./shot.jpg --confirm
google-photos-cli <command> --help                      # what any command takes
```

`--confirm` is the shell spelling of the confirmation that uploading requires.
`--json` gives JSON, `--compact` puts it on one line, `--select` keeps only the
fields you name, and errors are JSON on stderr whichever you pick.

`google-photos-cli schema <command>` prints the exact JSON Schema an MCP client
receives for that tool, which is how you can check the two surfaces really are
one thing.

### MCP server, for AI agents

`google-photos-mcp` is what Claude Code, Claude Desktop, Cursor and the rest
launch. You never run it by hand:

```bash
claude mcp add google-photos \
  -e GOOGLE_PHOTOS_CLIENT_ID=your-client-id \
  -e GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_PHOTOS_REFRESH_TOKEN=your-refresh-token \
  -- npx -y @thenavidm/google-photos-mcp-cli
```

Then just ask: _"let me pick a few photos, then put them in a new album with a caption between the second and third."_

Every other client is in [section 4](#4-connect-your-client-).

### Which one

| Where you are | What you can reach |
|---|---|
| An agent that can run shell commands, like Claude Code or Cursor | Both. The CLI is the cheaper one: it costs nothing until you type it |
| claude.ai, the Claude Desktop chat tab, or a phone | The server only. There is no shell to run a command in |
| A terminal, a script, cron or CI | The CLI only. There is no MCP client in a shell |

They are the same program reading the same tool definitions, so anything one
can do, the other can.

## Contents 📑

| # | Section | What is in it |
|---|---|---|
| 1 | [What you can ask it](#1-what-you-can-ask-it-) | Real prompts, not features |
| 2 | [Quick install](#2-quick-install-) | No account needed |
| 3 | [Setup](#3-setup-) | Every click, start to finish |
| 4 | [Connect your client](#4-connect-your-client-) | Every client, copy and paste |
| 5 | [Check it worked](#5-check-it-worked-) | One command |
| 6 | [Which surface, and what each costs](#6-which-surface-and-what-each-costs) | ~7,600 tokens a turn, or a few hundred |
| 7 | [Tools](#7-tools-) | All 26, grouped by what they reach |
| 8 | [Notes and gotchas](#8-notes-and-gotchas-) | What the API will not do |
| 9 | [Troubleshooting](#9-troubleshooting-) | Symptom to cause |
| 10 | [FAQ](#10-faq-) | The questions people actually ask |

## 1. What you can ask it 💬

- Let me pick some photos, then tell me what I chose.
- Put these six product shots in a new album called "Q3 Launch".
- Which of the ones you uploaded are videos, and how long are they?
- Write a description on everything in the launch album.
- Rename the Iceland album and set the third photo as its cover.
- Save what I just picked into my library so you can organise it later.
- Upload this to my brand account, not my personal one.
- Download the third photo I picked and tell me whether it is sharp enough to print.
- What can you actually see in my Google Photos, and what can you not?
- Add a caption between the second and third photo, then a map from Reykjavik to Vik.

**The last one is the point.** An album enrichment is a caption, a place, or a
map between two points, sitting inline between the photos rather than in a
description nobody opens. It is what makes an album read as a story, and almost
nothing outside Google's own app drives it.

## 2. Quick install ⚡

Node 20 or newer. Nothing else.

```bash
npx -y @thenavidm/google-photos-mcp-cli --version
```

That is the whole install. `npx` fetches it on demand, so there is nothing to
update later.

Installing the package needs no account. Only the config in
[section 4](#4-connect-your-client-) does.

## 3. Setup 🔑

Google Photos has no API keys, and Google does not support service accounts for
these APIs at all. The only way in is an OAuth client that you create, in a
Google Cloud project that you own, authorised by the account whose photos you
want to reach.

About ten minutes, once. It is free and you will not be asked for a card.

### Before you start

| You need | Check with | If missing |
|---|---|---|
| Node 20 or newer | `node -v` | [nodejs.org](https://nodejs.org) |
| A Google account | You have one | Any account works, personal or Workspace |

It has to be the account that owns the photos, or one you are willing to sign in as.

### Have an agent do it

The agent cannot sign in to Google for you. Only you can create the credential.
What it can do is walk you through it, wire up the config, and verify the
connection.

Paste this into Claude Code, Cursor, or any agent with terminal access:

```
Help me set up the Google Photos MCP server.

1. Open https://console.cloud.google.com/projectcreate and tell me what to name a project.
2. Walk me through enabling the Photos Picker API and the Photos Library API. Both.
3. Walk me through the Google Auth Platform consent screen, adding me as a test user,
   and adding these four scopes:
     https://www.googleapis.com/auth/photospicker.mediaitems.readonly
     https://www.googleapis.com/auth/photoslibrary.appendonly
     https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata
     https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata
4. Walk me through creating a Web application OAuth client with
   http://localhost:4180 as an authorised redirect URI.
5. STOP and wait. I will paste you the client ID and client secret.
6. Then run: GOOGLE_PHOTOS_CLIENT_ID=... GOOGLE_PHOTOS_CLIENT_SECRET=... \
   npx -y @thenavidm/google-photos-mcp-cli auth
   and tell me to approve it in the browser.
7. Add all three values to my MCP client config, then run doctor to verify.
```

### Or do it yourself

Console labels move. Where a step names a button, that is what it was called at
the time of writing. Where it describes a goal instead, that is deliberate.

**Step 1: Create a project.**

Go to [console.cloud.google.com](https://console.cloud.google.com/projectcreate)
and create a project. Name it something you will recognise in six months.

A project is just a container for the API access and the OAuth client. An
existing one works, but a fresh one keeps this credential separate from
everything else, which makes it safe to delete later.

**Step 2: Turn on both APIs.**

Google Photos is two separate APIs and this server uses both. Enabling one and
not the other gives you a half-working state where picking succeeds and albums
return `403`.

- [Enable the Photos Picker API](https://console.cloud.google.com/apis/library/photospicker.googleapis.com)
- [Enable the Photos Library API](https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com)

Each link opens that API in your project. Click to enable, go back, do the other.

> [!IMPORTANT]
> Check the project picker in the top bar first. Enabling an API in the wrong
> project is the single most common way to lose half an hour here.

**Step 3: Configure the consent screen.**

This lives under **Google Auth Platform**. If the project has never been set up,
its overview page offers a **Get started** button covering the same fields.

| Field | What to put |
|---|---|
| App name | Something plain, like `Photos MCP`. Google rejects names containing its own product names, so anything with "Google" in it bounces |
| User support email | Your own address, from the dropdown |
| Audience | **External**, unless you have a Workspace organisation and want to restrict it to people inside it |
| Contact information | Your email again. This one is for Google to reach you |

**Step 4: Add yourself as a test user.**

On the **Audience** page, add your own Google account as a test user.

This is easy to skip and it is what causes `access_denied` at the end of
sign-in. While the publishing status is **Testing**, only accounts on that list
can authorise the app, up to 100 of them.

> [!WARNING]
> In Testing, an authorisation expires **seven days** after you grant it, and
> the refresh token expires with it. Your setup works, then stops a week later
> for no visible reason. Set the publishing status to **In production** on the
> same page to stop that. For personal use this needs no verification review;
> you click past an "unverified app" warning during sign-in.

**Step 5: Add the scopes.**

On the **Data access** page, add these four. If one is not in the list, paste it
in manually.

```
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
https://www.googleapis.com/auth/photoslibrary.appendonly
https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata
https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata
```

Older guides ask for `photoslibrary` or `photoslibrary.readonly`. **Do not add
those.** Google removed them on 1 April 2025, and a project requesting one now
fails at the consent screen rather than degrading. The four above are the
complete set still available.

**Step 6: Create the OAuth client.**

On the **Clients** page, create a client.

- **Application type: Web application.** Not "Desktop app". A desktop client cannot be given a redirect URI, and the sign-in command needs one to catch the response.
- **Authorised redirect URI:** `http://localhost:4180`, exactly, with no trailing slash.

That port is where the `auth` command listens. If 4180 is busy, register
`http://localhost:<your port>` instead and set `GOOGLE_PHOTOS_AUTH_PORT` to
match. The string has to match byte for byte or Google returns
`redirect_uri_mismatch`.

Save, then copy the **client ID** and **client secret**. The secret is shown once.

**Step 7: Get a refresh token.**

```bash
export GOOGLE_PHOTOS_CLIENT_ID="your-client-id"
export GOOGLE_PHOTOS_CLIENT_SECRET="your-client-secret"

npx -y @thenavidm/google-photos-mcp-cli auth
```

A browser opens. Sign in as the account whose photos you want, click past the
unverified-app warning, and approve the four permissions. The command prints a
refresh token.

If it prints none, this account has already consented to this client before.
Remove the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
run it again.

### Revoking

[myaccount.google.com/permissions](https://myaccount.google.com/permissions),
find the app, remove it. That kills every token from that client at once.

The refresh token reaches your photo library until you do. Treat it like a
password: never paste one into an issue, a gist, or a chat.

## 4. Connect your client 🔌

All three values go in every block below.

### Claude Code

```bash
claude mcp add google-photos \
  -e GOOGLE_PHOTOS_CLIENT_ID=your-client-id \
  -e GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_PHOTOS_REFRESH_TOKEN=your-refresh-token \
  -- npx -y @thenavidm/google-photos-mcp-cli@latest
```

`--scope user` makes it available in every project rather than the current one.
Then run `/mcp` to confirm it is connected. Remove it with
`claude mcp remove google-photos`.

### Claude Desktop

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "google-photos": {
      "command": "npx",
      "args": ["-y", "@thenavidm/google-photos-mcp-cli@latest"],
      "env": {
        "GOOGLE_PHOTOS_CLIENT_ID": "your-client-id",
        "GOOGLE_PHOTOS_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_PHOTOS_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

Quit Claude Desktop completely and reopen it. On macOS use Cmd+Q; closing the
window is not enough.

> [!TIP]
> Claude Desktop does not inherit your shell PATH, so a bare `npx` can fail.
> Use the absolute path from `which npx` as the `command`.

### claude.ai on the web

claude.ai runs connectors from Anthropic's cloud, not from your machine, so it
cannot launch a local command. It needs a public HTTPS URL.

```bash
npx -y @thenavidm/google-photos-mcp-cli@latest --http --port 8000
```

Host that somewhere with a public HTTPS URL, then in claude.ai: **Customize**,
**Connectors**, **+**, **Add custom connector**. Paste the URL and click **Add**.

On Team and Enterprise an owner adds it first under **Organization settings,
Connectors**, then each member enables it under **Customize, Connectors**. Free
is limited to one custom connector. A server behind a VPN or firewall will not
connect.

### Cursor

`~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` for one. Same JSON
as Claude Desktop, key `mcpServers`. Reload the window afterwards.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, same JSON, key `mcpServers`, then reload.

### VS Code

`.vscode/mcp.json`. The key is **`servers`**, not `mcpServers`, and each entry
needs a `type`:

```json
{
  "servers": {
    "google-photos": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thenavidm/google-photos-mcp-cli@latest"],
      "env": {
        "GOOGLE_PHOTOS_CLIENT_ID": "your-client-id",
        "GOOGLE_PHOTOS_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_PHOTOS_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.google-photos]
command = "npx"
args = ["-y", "@thenavidm/google-photos-mcp-cli@latest"]

[mcp_servers.google-photos.env]
GOOGLE_PHOTOS_CLIENT_ID = "your-client-id"
GOOGLE_PHOTOS_CLIENT_SECRET = "your-client-secret"
GOOGLE_PHOTOS_REFRESH_TOKEN = "your-refresh-token"
```

### Gemini CLI

`~/.gemini/settings.json`, same JSON as Claude Desktop, key `mcpServers`.

### More than one Google account

Swap the three single-account variables for `GOOGLE_PHOTOS_ACCOUNTS`, a JSON
array. Each account carries its own client id and secret, because a refresh
token only works with the OAuth client that minted it. Two Google accounts
authorised through the same Cloud project can reuse the same pair.

```json
{
  "mcpServers": {
    "google-photos": {
      "command": "npx",
      "args": ["-y", "@thenavidm/google-photos-mcp-cli@latest"],
      "env": {
        "GOOGLE_PHOTOS_ACCOUNTS": "[{\"name\":\"personal\",\"client_id\":\"...\",\"client_secret\":\"...\",\"refresh_token\":\"...\"},{\"name\":\"brand\",\"client_id\":\"...\",\"client_secret\":\"...\",\"refresh_token\":\"...\"}]",
        "GOOGLE_PHOTOS_DEFAULT_ACCOUNT": "personal"
      }
    }
  }
}
```

Run `auth` once per account, signing in as a different Google account each time.
Then pass `account: "brand"` on any tool, or leave it off and the default acts.
`list_accounts` shows what is connected.

An exact name wins over a prefix, so `personal` and `personal-archive` stay
distinct rather than resolving to whichever came first.

### Everything else

Zed, Cline, Continue and anything else that speaks MCP over stdio take the same
three things: the command `npx`, the args, and the env block.

### Docker

```bash
docker build -t google-photos-mcp .
docker run -i --rm \
  -e GOOGLE_PHOTOS_CLIENT_ID=your-client-id \
  -e GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_PHOTOS_REFRESH_TOKEN=your-refresh-token \
  google-photos-mcp
```

## 5. Check it worked 🩺

```bash
npx -y @thenavidm/google-photos-mcp-cli@latest doctor
```

`doctor` checks four things in the order they fail and stops at the first real
problem: credentials present, refresh token mints an access token, every scope
actually landed in the grant, and one live API call.

| Symptom | Cause |
|---|---|
| `Missing: GOOGLE_PHOTOS_...` | A value is not reaching the server. Check the JSON is valid |
| `invalid_grant` | Seven days passed with the consent screen in Testing, or the token was revoked |
| `The grant is missing N scope(s)` | A scope was added after the token was minted. Run `auth` again |

## 6. Which surface, and what each costs

Both surfaces carry the same 26 tools. They differ in when you pay for them.

| Question | MCP server | CLI |
|---|---|---|
| Loaded every turn | **~7,600 tokens** | nothing |
| Loaded when Google Photos comes up | nothing more | ~2,600, once |
| Works on claude.ai and mobile | yes | no, there is no shell there |
| Works in a script, cron or CI | no | yes |
| You invoke it by | asking in plain language | typing a command |

An MCP server sends its whole tool list to the model on **every turn**, whether
you mention Google Photos or not. That is the price of being connected at all,
before you ask anything. It is not unusual, and almost nobody publishes it.

The number above is measured, not estimated: a real `initialize` plus
`tools/list` handshake against this build returns 31,707 bytes of tool
definitions, which tokenises to 7,271, plus 352 tokens of server instructions.

Over twenty turns where Google Photos comes up once, that is roughly 152,000
tokens against 2,600. When the whole conversation is about your photos, the gap
closes and the server is the better experience, because you ask in plain
language instead of remembering flags.

### Spending less

**Turn the server off when you are not using it.** In Claude Code that is
`@google-photos` to toggle, and every client has an equivalent.
`GOOGLE_PHOTOS_READ_ONLY=1` drops it to the 15 reading tools, measured at 3,958
tokens.

**Or install the CLI and skip the server.** All 26 tools stay reachable, the
standing cost falls to nothing, and an agent pays only when the subject comes
up: 372 tokens for the command listing, or 2,612 for the whole `SKILL.md`.

## 7. Tools 🛠️

26 tools. Read-only mode leaves 15.

### Picking from your library

The only route to photos this server did not upload. Asynchronous by design: a
human has to actually use the URL before anything is visible.

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
| `get_album` | One album, with its cover and item count |
| `update_album` | Rename, or set the cover photo |
| `add_to_album` | Add up to 50 items |
| `remove_from_album` | Remove up to 50, keeping them in the library |
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
| `list_accounts` | Every connected Google account, and which one is the default |
| `auth_status` | Which account, which scopes, and what is missing |
| `quota_status` | How much of the daily budget is left |
| `raw` | Call an endpoint this server does not wrap |

### Resources and prompts

Two resources: `google-photos://status` for the connection, and
`google-photos://capabilities` for a plain account of what the API can and
cannot do. A model that reads the second stops proposing things Google removed.

Three prompts: **pick-and-work**, **build-album**, and **diagnose**.

## 8. Notes and gotchas 📓

**Google removed whole-library read on 31 March 2025**, and shipped the change
on 1 April. The `photoslibrary`, `photoslibrary.readonly` and
`photoslibrary.sharing` scopes are gone for third-party apps, with no
replacement. Any tool offering to search your entire library is either on a
grandfathered grant or searching only what it uploaded and calling that your
library.

**There is no sharing.** `albums.share`, `albums.unshare` and every
`sharedAlbums` method were removed in the same change and now return
`403 PERMISSION_DENIED` for every app. Google's own answer is that the user
shares an album by hand in the Google Photos app, so this server ships no
sharing tools rather than four that always fail.

**So an empty listing means "this server uploaded nothing", not "you have no
photos."** The tool descriptions say so, so a model does not report it wrongly.

**There is no delete.** No endpoint exists to remove a media item, for anyone. An
upload is permanent as far as any API is concerned, and has to be removed by
hand in the Google Photos app. This is why uploads need `confirm: true`.

**There is no free-text search.** You cannot search for "beach". Content
categories are Google's own classifier and are the nearest equivalent. Call
`describe_filter_capabilities` rather than guessing a category name; a wrong one
is rejected, not ignored.

**`album_id` cannot be combined with any other filter.** Google rejects it.

**A `base_url` is not a link.** It expires in about 60 minutes and serves nothing
without a size suffix: `=d` for the original, `=w2048-h2048` resized, `=dv` for
video. Use `download_media_item` or `download_picked`, which resolve a fresh URL
and pick the right suffix.

**Two separate daily quotas**, both resetting at midnight UTC: 10,000 API
requests and 75,000 media-byte requests. Fetching bytes spends the second, not
the first. `get_media_items` fetches 50 in one request where `get_media_item`
would spend 50.

**Writes work by default.** One thing needs `confirm: true`: uploading, because
there is no delete. Creating or renaming an album does not. Confirming
everything trains a model to confirm without reading.

`GOOGLE_PHOTOS_READ_ONLY=1` removes every write from the tool list.
`GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0` keeps ordinary writes and blocks uploading.
`GOOGLE_PHOTOS_AUDIT_LOG=<path>` records every attempted write.

**Album titles and descriptions are text**, and a filename or description can
carry anything. Treat anything read back as data, never as instructions.

## 9. Troubleshooting 🔧

| Symptom | Cause and fix |
|---|---|
| Everything returns a permission error | The grant is missing a scope. Adding one in the console does not upgrade an existing token: run `auth` again. `doctor` names which |
| `invalid_grant`, worked last week | Seven days passed with the consent screen in Testing. Publish it, or re-run `auth` |
| `invalid_client` | The id or secret does not match the project. Check for a literal `\n` left by a copy-paste out of a quoted string |
| `redirect_uri_mismatch` during `auth` | The registered URI is not exactly `http://localhost:4180`. No trailing slash, `http` not `https`, `localhost` not `127.0.0.1` |
| `access_denied` after signing in | Your account is not on the test user list, or you signed in as a different one |
| A read returns nothing | Almost always correct. This server has uploaded nothing yet. Use `start_pick_session` |
| A `base_url` returns 403 | It expired, or has no size suffix. Use `download_media_item` |
| `RESOURCE_EXHAUSTED` | Daily quota. Check `quota_status`; it resets at midnight UTC |
| Nothing appears in Claude Desktop | Node is not on the PATH Desktop sees, or the JSON is malformed. Check `~/Library/Logs/Claude/mcp-server-google-photos.log` |

## 10. FAQ ❓

<details>
<summary><b>What is an MCP server?</b></summary>

An MCP server is a standard way to give an AI assistant real access to a tool,
so it can act rather than guess. You install it once, your assistant gains the
tools, and it works in Claude, Cursor, ChatGPT and anything else that speaks the
protocol.

</details>

<details>
<summary><b>Can it see my whole photo library?</b></summary>

It cannot, and this is the most important thing to understand about it. Google
removed the broad library scopes from new grants on 1 April 2025. An app created
today can read only what it uploaded itself, plus whatever you hand it through
Google's own picker.

Anything promising full library access on a new project is describing a world
that no longer exists.

</details>

<details>
<summary><b>What is the picker, and why do I have to use it?</b></summary>

The picker is Google's own selection screen. You choose the photos, and only
those become visible to the server. It exists because Google decided that
reading someone's entire library should be the user's explicit choice each time
rather than a permission granted once.

In practice you pick a set, the server reads it, and nothing else is exposed.

</details>

<details>
<summary><b>What permissions does it ask for?</b></summary>

It asks for four narrow scopes: read what you picked, upload new media and
create albums, read back only what this app created, and edit descriptions and
album membership for that same app-created data. None of them grant access to
photos it did not upload or you did not pick.

</details>

<details>
<summary><b>Is my data sent anywhere? Who can see it?</b></summary>

Nothing leaves your machine except calls to Google. There is no backend here, no
account to create and no telemetry. Your credential sits in your client's config
or your local data directory.

</details>

<details>
<summary><b>Can it delete my photos?</b></summary>

It cannot delete anything. Google's API exposes no delete for library media, so
there is nothing to call. The strongest thing it does is edit descriptions and
album membership for items it created itself.

</details>

<details>
<summary><b>Can it post without me asking?</b></summary>

It uploads and creates albums when you ask it to. Setting
`GOOGLE_PHOTOS_READ_ONLY=1` removes every write tool from the list, so the model
cannot see or call them.

</details>

<details>
<summary><b>Does it cost anything?</b></summary>

It costs nothing. The server is MIT licensed and the Google Photos API is free.
Uploads count against your normal Google storage, the same as any other upload.

</details>

<details>
<summary><b>Does it work with ChatGPT and Cursor, or only Claude?</b></summary>

It works with any MCP client. Claude Code, Claude Desktop, Cursor, Windsurf, VS
Code, Codex CLI and Gemini CLI all run it the same way.

</details>

<details>
<summary><b>How do I disconnect it?</b></summary>

Remove the app's access at myaccount.google.com under Security, then Third-party
apps, which invalidates the token immediately. Then remove the server from your
client's config.

</details>

<details>
<summary><b>Is my refresh token safe?</b></summary>

It is scoped to four permissions and no more: read what you pick, upload, read back what it uploaded, and edit what it created. It cannot read your existing photos and cannot reach any other Google service.

It still reaches a real photo library, so treat it as a password. Revoke it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

</details>

<details>
<summary><b>Why do I have to create my own Google Cloud project?</b></summary>

Google Photos has no API keys and does not support service accounts for these APIs. A user OAuth grant is the only way in, and a grant needs a client. It is about ten minutes, once, and it is free.

</details>

<details>
<summary><b>Why did it stop working after a week?</b></summary>

The OAuth consent screen is still in Testing, where Google expires authorisations after seven days and the refresh token with them. Set the publishing status to In production on the Audience page.

</details>

<details>
<summary><b>Do I need Google to verify my app?</b></summary>

Not for your own use. You click past an "unverified app" warning during sign-in. Verification matters only when other people will use your client, and Google Photos scopes need a separate review on top of the usual one.

</details>

<details>
<summary><b>Can I connect more than one Google account?</b></summary>

Yes. Set `GOOGLE_PHOTOS_ACCOUNTS` to a JSON array instead of the three single-account variables, run `auth` once per account, and pass `account: "brand"` on any tool. `list_accounts` shows what is connected. [Section 4](#4-connect-your-client-) has the config block.

</details>

<details>
<summary><b>Can I use it from claude.ai on the web?</b></summary>

Yes, but claude.ai runs connectors from Anthropic's cloud, so it needs the HTTP transport hosted somewhere with a public HTTPS URL. [Section 4](#4-connect-your-client-) covers it.

</details>

<details>
<summary><b>How do I stop an agent changing anything?</b></summary>

`GOOGLE_PHOTOS_READ_ONLY=1`. The write tools are not registered at all, so a model cannot call what it cannot see, and the list drops from 26 tools to 15.

</details>

<details>
<summary><b>How do I know it is actually working?</b></summary>

`doctor`. It tests credentials, scopes and a live API call, and names the first real problem rather than leaving you to guess.

</details>

## Environment variables

Three are required. Everything else has a working default and exists so you can
tighten or tune it.

**Credentials**

| Variable | What it is |
|---|---|
| `GOOGLE_PHOTOS_CLIENT_ID` | OAuth client id, from your own Google Cloud project. [Section 3](#3-setup-) creates one |
| `GOOGLE_PHOTOS_CLIENT_SECRET` | The matching client secret |
| `GOOGLE_PHOTOS_REFRESH_TOKEN` | From `google-photos-mcp auth` |
| `GOOGLE_PHOTOS_ACCOUNTS` | A JSON array instead, for several Google accounts at once. Replaces the three above |
| `GOOGLE_PHOTOS_DEFAULT_ACCOUNT` | Which account acts when a tool names none. Comma-separated, in order of preference. Defaults to the first configured |

**Safety**

| Variable | Default | What it does |
|---|---|---|
| `GOOGLE_PHOTOS_READ_ONLY` | `0` | `1` removes every write, leaving the 15 reading tools |
| `GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE` | `1` | `0` keeps ordinary writes and blocks uploading |
| `GOOGLE_PHOTOS_AUDIT_LOG` | none | Path to an append-only JSON-lines record of every attempted write |

**Tuning**

| Variable | Default | What it does |
|---|---|---|
| `GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS` | `30000` | Per-request deadline |
| `GOOGLE_PHOTOS_MAX_RETRIES` | `2` | Retries on 429 and 5xx, for idempotent verbs only |
| `GOOGLE_PHOTOS_AUTH_PORT` | `4180` | Loopback port `auth` listens on. Must match a registered redirect URI |

**Serving over HTTP** (`--http`, read [SECURITY.md](SECURITY.md) before you use it)

| Variable | Default | What it does |
|---|---|---|
| `GOOGLE_PHOTOS_HTTP_PORT` | `8787` | Port to bind |
| `GOOGLE_PHOTOS_HTTP_HOST` | `127.0.0.1` | Interface to bind. Widen it only if you mean it |
| `GOOGLE_PHOTOS_HTTP_TOKEN` | none | Bearer token the HTTP transport requires, when set |

## Versions

See [CHANGELOG.md](CHANGELOG.md), newest first, with the upstream API and action
versions this was last checked against.

## Questions

Run into a problem or have a question? [Open an issue](https://github.com/thenavidm/google-photos-mcp-cli/issues) and I will help.

## About the author 👋

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This Google Photos MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=google-photos-mcp-cli)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

If this is useful, star the repo and come say hi on [X](https://x.com/thenavidm).

## Dependencies

| Library | License | What it does |
|---|---|---|
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server and transports |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool argument schemas and validation |

## Security

Found a vulnerability? [Report it privately](https://github.com/thenavidm/google-photos-mcp-cli/security/advisories/new), not as a public issue. [SECURITY.md](SECURITY.md) covers what this server holds, the write-safety model, and running it over HTTP.

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or connected to Google LLC.

---

© 2026 [NM Media](https://navid.media?utm_source=github&utm_medium=readme&utm_campaign=google-photos-mcp-cli). Made with ❤️ by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=readme&utm_campaign=google-photos-mcp-cli).
