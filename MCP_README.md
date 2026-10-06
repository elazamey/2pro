# MCP (Model Context Protocol) servers
#
# This file lets MCP-compatible clients (Claude Desktop, Cursor, Windsurf,
# Cline, celia_agent, ...) discover and spawn local MCP servers that give
# AI agents access to additional tools and context.
#
# Currently configured:
#   - figma        — read Figma files, extract components and design tokens,
#                    generate code from frames. Requires FIGMA_ACCESS_TOKEN.
#   - google-drive — search/read/upload Google Drive files. Requires
#                    GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (OAuth Desktop App).
#   - gmail        — read/send Gmail messages. Uses the same Google OAuth app.
#
# Usage:
#   1. Create a Figma Personal Access Token at
#      https://www.figma.com/settings
#      and export FIGMA_ACCESS_TOKEN=figd_xxx
#
#   2. Create a Google Cloud project, enable Drive + Gmail APIs, and create an
#      OAuth 2.0 Desktop client.
#      Export GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
#      (You can bootstrap the OAuth flow via `2pro google login`.)
#
#   3. Point your MCP client at this file (Claude Desktop config, Cursor,
#      Windsurf, Cline, `mcp` CLI, celia_agent, …).
#
# The 2pro CLI and dashboard also talk to Figma / Google directly using the
# same tokens (see packages/figma, packages/google) — MCP is an additional
# integration path for AI agents, not a runtime requirement.
