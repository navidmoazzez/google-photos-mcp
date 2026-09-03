# Security

## Reporting a vulnerability

[Report it privately](https://github.com/thenavidm/google-photos-mcp-cli/security/advisories/new).
Please do not open a public issue for a security problem: an issue is visible to
everyone the moment you file it, including whoever would use the bug.

Include what you did, what happened, and what you expected. A proof of concept
helps. Reporters are credited in the fix notes unless they would rather not be.

## What this server holds

**An OAuth refresh token**, in `GOOGLE_PHOTOS_REFRESH_TOKEN`, alongside the
client id and secret of an OAuth application you created.

The token is scoped, which is the one comfort here. It carries four permissions
and no more: read what the user picks in the picker, upload media, read back
what this app uploaded, and edit what this app created. It cannot read the
user's existing photos, cannot delete anything, and reaches no other Google
service.

It is still a live credential against a real photo library until it is revoked.
Treat it as a password. Never paste one into an issue, a gist, or a chat.

Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
That kills every token from that client at once.

The server never writes any of the three values to disk. They live wherever your
MCP client keeps its config.

## Photo bytes

`download_media_item`, `download_picked` and the upload tools hold file contents
in memory for the length of one call and never cache them. Nothing is written to
a temporary file.

An access token is attached only to requests going to Google's own hosts. When
`upload_from_url` fetches an arbitrary public URL it sends no credentials, so a
hostile URL cannot collect a Google token.

## The write-safety model

Writes work by default, because a server where every write needs a flag teaches
people to pass that flag reflexively.

Two things require `confirm: true`:

**Uploading.** Google exposes no delete endpoint for media items. An upload is
permanent as far as any API is concerned, and has to be removed by hand.

`GOOGLE_PHOTOS_READ_ONLY=1` removes every write from the tool list entirely, so
a model cannot call one. `GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0` keeps ordinary
writes and blocks uploading. `GOOGLE_PHOTOS_AUDIT_LOG` records every
attempted write, allowed and blocked alike.

## Prompt injection

Album titles, filenames and photo descriptions are text people wrote, and a
filename can carry anything.

Anything read back from the API is data. The server's instructions tell the
model this explicitly, but a client that auto-approves every tool call is
trusting that instruction to hold. `GOOGLE_PHOTOS_READ_ONLY=1` is the guarantee
that does not depend on the model behaving.

## Running over HTTP

`--http` binds to `127.0.0.1` and serves `/health`.

Before binding beyond localhost, set `GOOGLE_PHOTOS_HTTP_TOKEN` to a random
string and put it behind TLS. An open port here is upload access to somebody's
photo library.

## Dependencies

Two, both MIT: the MCP TypeScript SDK and zod. Fewer dependencies is fewer
places for a supply-chain problem to enter.

## Good-faith research

Read, run and pull apart anything here. Nobody but the maintainer can change
this repository, so nothing you do while investigating puts it at risk.

The care is owed to the service the tool talks to, not to the code. When
testing, use your own account and your own data. Do not point it at somebody
else's, and do not hammer a shared API to the point where other people notice.
If a test could affect anyone but you, stop and send a private report first.

Research done in that spirit is welcome, and nothing here is a trap.
