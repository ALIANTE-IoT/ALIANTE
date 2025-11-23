# Biodiversity MCP Connector

This folder contains a minimal [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes the new services in this repo:

- `upload_drone_image`: uploads a base64 encoded drone photo to the `image-storage-service` and returns the hosted URL.
- `analyze_biodiversity_image`: proxies the ChatGPT-backed biodiversity analysis endpoint.
- `list_hosted_images`: returns the filenames already saved on the image host.

## Running locally

```bash
cd mcp/biodiversity-mcp
cp .env.example .env  # optional helper file if you create one
# configure IMAGE_SERVICE_API / ANALYZER_SERVICE_API to point at your running containers
npm install
npm start
```

This starts an HTTP MCP server on `http://localhost:3030/mcp`. Any MCP-compatible client (ChatGPT, Claude Code, VS Code MCP, etc.) can connect to that URL. In ChatGPT, add a new MCP connection pointing to the URL and give it a name like "Biodiversity".

Environment variables supported:

- `PORT` – port for the MCP HTTP server (default `3030`).
- `IMAGE_SERVICE_API` – upload endpoint exposed by `image-storage-service` (`http://127.0.0.1:4100/api/images`).
- `ANALYZER_SERVICE_API` – analysis endpoint exposed by `tree-analyzer-service` (`http://127.0.0.1:4000/api/biodiversity`).

> ⚠️ The MCP server assumes the underlying services are reachable from where it runs. If ChatGPT connects over the public internet you must expose the Docker services accordingly (or run the MCP server on the same machine and port-forward it).
