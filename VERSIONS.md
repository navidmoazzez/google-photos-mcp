# Versions

## 1.0.0

First release.

27 tools across both halves of the Google Photos API: the Picker API for
reaching the user's whole library through them, and the Library API for media
this server uploaded.

Built around what the API actually offers after Google removed whole-library
read access on 1 April 2025, rather than around what it used to offer. The tool
descriptions, the `google-photos://capabilities` resource and
`describe_filter_capabilities` all state the limits plainly, so a model reports
"this server has uploaded nothing" instead of "your library is empty".

- Picker flow: `start_pick_session`, `check_pick_session`, `list_picked_media`, `download_picked`
- Albums: create, list, get, update, share, unshare, list shared, add and remove items, enrichments
- Media: list, search, get one, get many, set description, download
- Uploads: from URL, from a local file, from a picker selection, or album and contents in one call
- Connection: `auth_status`, and a `raw` escape hatch
- `google-photos-mcp auth` runs the one-time sign-in and prints a refresh token
- `google-photos-mcp doctor` checks credentials, scopes and a live API call, in the order they fail
- `GOOGLE_PHOTOS_READ_ONLY=1` drops the tool list to the 14 reads
- Uploading and sharing require `confirm: true`, because neither can be undone through the API
