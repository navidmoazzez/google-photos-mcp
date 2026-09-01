# Versions

| Component | Version | Checked |
|---|---|---|
| MCP TypeScript SDK | ^1.18.0 | 2026-09-01 |
| zod | ^3.23.8 | 2026-09-01 |
| Node | >=20 | 2026-09-01 |
| Google Photos Picker API | v1 | 2026-09-01 |
| Google Photos Library API | v1 | 2026-09-01 |
| actions/checkout | v7 | 2026-09-01 |
| actions/setup-node | v7 | 2026-09-01 |

## 1.0.0

First release.

28 tools across both halves of the Google Photos API: the Picker API for
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
- Connection: `auth_status`, `quota_status`, and a `raw` escape hatch
- Both daily quotas tracked locally (10,000 API requests, 75,000 media-byte requests, midnight UTC) so the ceiling refuses before the call rather than returning a 429 a model reads as transient
- `google-photos-mcp auth` runs the one-time sign-in and prints a refresh token
- `google-photos-mcp doctor` checks credentials, scopes and a live API call, in the order they fail
- stdio and streamable HTTP transports
- `GOOGLE_PHOTOS_READ_ONLY=1` drops the tool list to the 15 reads
- Uploading and sharing require `confirm: true`, because Google exposes no delete endpoint and a share link cannot be recalled
