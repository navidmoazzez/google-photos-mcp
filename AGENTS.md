# Working on this repo

The one document for agents. `CLAUDE.md` points here.

## What this is

An MCP server for Google Photos. TypeScript, ESM, Node 20+, stdio and
streamable HTTP. Published as `@thenavidm/google-photos-mcp-cli`.

## The constraint that shapes everything

Google removed whole-library read access on 31 March 2025. The
`photoslibrary`, `photoslibrary.readonly` and `photoslibrary.sharing` scopes no
longer exist for third-party apps.

**Do not add a tool that claims to search or browse the user's library.** It
cannot work. If you find yourself writing one, what you actually want is the
picker flow in `src/tools/picker.ts`.

The four scopes in `src/config.ts` are the complete set still available. Adding
a removed one breaks consent for everybody, and it fails at the Google end where
no amount of reading this code will explain it.

## Layout

```
src/
  index.ts        entry, arg parsing, the auth and doctor commands
  server.ts       assembles tools, resources, prompts, instructions
  config.ts       env resolution, the scope list
  safety.ts       confirm gating, read-only, audit log, MCP annotations
  doctor.ts       the four checks, in the order they fail
  api/
    auth.ts       refresh-token exchange, and the one-time consent flow
    client.ts     both hosts, retries, uploads, byte fetching
    errors.ts     Google's errors turned into something a model can act on
  tools/
    kit.ts        defineTool, register, shared args
    picker.ts     the picker flow
    albums.ts     albums and membership
    media.ts      reading and describing
    uploads.ts    getting bytes in
    meta.ts       auth_status and raw
  format/items.ts shaping items and albums for a model
```

## Adding a tool

1. `defineTool` in the right module. Group by what it reaches, not by endpoint.
2. Set `risk` honestly. `destructive` means it cannot be undone through the API,
   which here means uploading, and nothing else.
3. `destructive` tools must spread `...confirmArg` into their schema. A test
   enforces that the two always match.
4. Write the description for a model that cannot see the code. Say what it
   reaches, what it costs, and what will surprise the caller. Platform
   constraints belong in the description, not only in the README.
5. Add it to the README tool table and bump the count in three places:
   `package.json` description, `README.md`, `SKILL.md`.

## Before claiming it works

`npm test` is not enough. It fakes the network, deliberately.

Run the real handshake:

```bash
npm run build
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"p","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| node dist/index.js
```

CI runs the same thing, because a build that compiles says nothing about whether
the server starts.

## Writing

No em dashes. Short paragraphs. Comments explain why, not what.

Never name another project, repo or maintainer as a comparison, in code, docs or
commits. Never put AI attribution in a commit message.

Nothing private goes in this repo: no real credentials, no internal hostnames,
no environment values from anywhere else.

## Setup docs are facts

Every button name and menu path in the README setup section came from Google's live
documentation. Console labels get rewritten often. If you cannot verify a label,
describe the goal instead of naming the control: a wrong button name is worse
than none, because the reader cannot tell it is wrong until it fails.
