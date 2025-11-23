import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

dotenv.config();

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SAM3_MCP_URL =
    process.env.SAM3_MCP_URL ||
    "https://lauz.lab.students.cs.unibo.it/gradio_api/mcp/sse";

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const summarizeText = (response) => {
    if (!response) return "";
    if (Array.isArray(response.output_text) && response.output_text.length) {
        return response.output_text.join("\n").trim();
    }
    if (Array.isArray(response.output)) {
        return response.output
            .map((block) =>
                (block.content || []).map((part) => part?.text || "").join(""),
            )
            .join("\n")
            .trim();
    }
    return "";
};

const normalizeList = (value) => {
    if (!value) return [];
    if (Array.isArray(value))
        return value.filter(Boolean).map((item) => String(item));
    return [String(value)];
};

const extractTextContent = (content = []) =>
    content
        .filter((part) => typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();

const callSam3Segmentations = async (imageUrl, prompt) => {
    if (!SAM3_MCP_URL) {
        return null;
    }
    let samClient;
    try {
        const targetUrl = new URL(SAM3_MCP_URL);
        samClient = new McpClient({
            name: "biodiversity-segmentation-proxy",
            version: "1.0.0",
        });
        let transport;
        try {
            transport = new StreamableHTTPClientTransport(targetUrl);
            await samClient.connect(transport);
        } catch (streamableError) {
            console.warn(
                "Streamable HTTP connection failed, falling back to SSE",
                streamableError,
            );
            transport = new SSEClientTransport(targetUrl);
            await samClient.connect(transport);
        }
        const result = await samClient.callTool({
            name: "segment_image",
            arguments: {
                input_image: imageUrl,
                text_prompt: prompt || "tree",
                threshold: 0.4,
            },
        });

        const textPayload = extractTextContent(result?.content);
        if (textPayload) {
            try {
                return JSON.parse(textPayload);
            } catch (error) {
                console.warn(
                    "SAM3 returned non-JSON text. Forwarding raw text.",
                );
                return textPayload;
            }
        }
        return result?.content ?? null;
    } catch (error) {
        console.error("SAM3 MCP call failed", error);
        return null;
    } finally {
        if (samClient) {
            try {
                await samClient.close();
            } catch (closeError) {
                console.warn("Failed to close SAM3 client", closeError);
            }
        }
    }
};

const promptTemplate = `You are a biodiversity analyst assisting an insurance inspector.
Given a drone photo URL, a short request from the inspector, and optional SAM3 segmentation metadata, produce JSON with this schema:
{
  "focus": string, // what ecosystem component you focused on
  "summary": string,
  "observations": string[],
  "recommended_actions": string[],
  "sam3_segmentations": object | array | string // mirror whatever SAM3 returned
}`;

const buildAnalysis = (parsed, fallbackText, prompt, sam3Segmentations) => ({
    focus: parsed?.focus || prompt,
    summary: parsed?.summary || fallbackText,
    observations: normalizeList(parsed?.observations),
    recommendedActions: normalizeList(
        parsed?.recommended_actions || parsed?.recommendations,
    ),
    sam3Segmentations:
        parsed?.sam3_segmentations ||
        parsed?.sam3Segmentations ||
        sam3Segmentations ||
        null,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/api/biodiversity", async (req, res) => {
    const { imageUrl, prompt } = req.body || {};

    if (!imageUrl) {
        return res.status(400).json({ error: "imageUrl is required" });
    }
    if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
    }
    if (!client) {
        return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    try {
        const sam3Segmentations = await callSam3Segmentations(imageUrl, prompt);
        const segmentationText = sam3Segmentations
            ? `SAM3 segmentation JSON:\n${JSON.stringify(sam3Segmentations)}`
            : "SAM3 segmentation unavailable.";

        console.log("[SAM3 MCP]", {
            endpoint: SAM3_MCP_URL,
            imageUrl,
            hasSegmentation: Boolean(sam3Segmentations),
        });

        const appendedPrompt = `${prompt.trim()}

Segmentation context (from SAM3):
${segmentationText}

When you respond, include the segmentation data verbatim under the "sam3_segmentations" key of your JSON result.`;

        const completion = await client.responses.create({
            model: OPENAI_MODEL,
            temperature: 0.2,
            max_output_tokens: 800,
            input: [
                {
                    role: "system",
                    content: [{ type: "input_text", text: promptTemplate }],
                },
                {
                    role: "user",
                    content: [
                        { type: "input_text", text: appendedPrompt },
                        { type: "input_image", image_url: imageUrl },
                    ],
                },
            ],
        });

        const text = summarizeText(completion);
        let parsed;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch (error) {
            console.warn("OpenAI response not JSON. Forwarding raw text.");
        }

        res.json({
            model: OPENAI_MODEL,
            imageUrl,
            prompt,
            analysis: buildAnalysis(parsed, text, prompt, sam3Segmentations),
            sam3Segmentations,
            raw: parsed || text,
        });
    } catch (error) {
        console.error("OpenAI analysis failed", error);
        res.status(502).json({
            error: "OpenAI request failed",
            details: error.response?.data || error.message,
        });
    }
});

app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", model: OPENAI_MODEL });
});

app.listen(PORT, () => {
    console.log(`Biodiversity analyzer listening on port ${PORT}`);
});
