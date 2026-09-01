#!/usr/bin/env bash
# Build from source and print the client config block.
# For the published package use npx; see the README.
set -euo pipefail

cd "$(dirname "$0")/.."
npm install
npm run build

cat <<JSON

Built. Add this to your MCP client config:

{
  "mcpServers": {
    "google-photos": {
      "command": "node",
      "args": ["$(pwd)/dist/index.js"],
      "env": {
        "GOOGLE_PHOTOS_CLIENT_ID": "your-client-id",
        "GOOGLE_PHOTOS_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_PHOTOS_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}

No credentials yet? See the README setup section, then run:
  node $(pwd)/dist/index.js auth
JSON
