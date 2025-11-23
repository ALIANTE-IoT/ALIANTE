import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Buffer } from "node:buffer";

const IMAGE_API =
    process.env.IMAGE_SERVICE_API || "http://127.0.0.1:4100/api/images";
const ANALYZER_API =
    process.env.ANALYZER_SERVICE_API ||
    "http://127.0.0.1:4000/api/biodiversity";
const PORT = parseInt(process.env.PORT || "3030", 10);

const server = new McpServer({
    name: "biodiversity-mcp",
    version: "1.0.0",
    description:
        "Expose the drone image store and biodiversity analyzer as MCP tools.",
});

const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed (${response.status}): ${text}`);
    }
    return response.json();
};

server.registerTool(
    "upload_drone_image",
    {
        title: "Upload drone snapshot",
        description:
            "Upload a base64 encoded drone image to the shared image server and return the public URL.",
        inputSchema: z.object({
            base64Image: z.string().describe("base64 encoded image contents"),
            filename: z
                .string()
                .optional()
                .describe("Desired filename with extension"),
        }),
        outputSchema: z.object({
            url: z.string().url(),
            filename: z.string(),
            size: z.number(),
        }),
    },
    async ({ base64Image, filename }) => {
        const bytes = Buffer.from(base64Image, "base64");
        const formData = new FormData();
        const safeName = filename || `upload-${Date.now()}.jpg`;
        formData.append("image", new Blob([bytes]), safeName);
        const result = await fetchJson(IMAGE_API, {
            method: "POST",
            body: formData,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
        };
    },
);

server.registerTool(
    "analyze_biodiversity_image",
    {
        title: "Analyze biodiversity",
        description:
            "Send an image URL and prompt to the ChatGPT-backed analyzer.",
        inputSchema: z.object({
            imageUrl: z.string().url(),
            prompt: z.string().min(5),
        }),
        outputSchema: z.object({
            model: z.string(),
            analysis: z.object({
                focus: z.string(),
                summary: z.string(),
                observations: z.array(z.string()).optional(),
                recommendedActions: z.array(z.string()).optional(),
            }),
        }),
    },
    async ({ imageUrl, prompt }) => {
        const result = await fetchJson(ANALYZER_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl, prompt }),
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
        };
    },
);

server.registerTool(
    "list_hosted_images",
    {
        title: "List stored images",
        description:
            "Fetch the list of filenames currently stored on the image server.",
        inputSchema: z.object({}).optional(),
        outputSchema: z.object({ files: z.array(z.string()) }),
    },
    async () => {
        const result = await fetchJson(IMAGE_API);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
        };
    },
);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
    console.log(
        `Biodiversity MCP server ready on http://localhost:${PORT}/mcp`,
    );
});
