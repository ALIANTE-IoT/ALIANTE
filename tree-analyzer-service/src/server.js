import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_DIR = path.resolve(__dirname, "../sample-images");

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SAM3_MCP_URL =
    process.env.SAM3_MCP_URL ||
    "https://lauz.lab.students.cs.unibo.it/gradio_api/mcp/sse";
const DRONE_THING_URL =
    process.env.DRONE_THING_URL || "http://servient1:8080/drone1-thing";
const DEMO_TAKEOFF_ALT = Number(process.env.DEMO_TAKEOFF_ALT || "30");
const IMAGE_SERVICE_API =
    process.env.IMAGE_SERVICE_API || "http://image-storage:4100/api/images";
const CLUSTERING_URL =
    process.env.CLUSTERING_URL || "http://clustering:5051/receive";
const TAKE_PHOTO_DELAY_MS = Number(process.env.DEMO_CAPTURE_DELAY_MS || "2500");

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

const SAMPLE_IMAGES = [
    {
        id: "demo-forest",
        filePath: path.join(SAMPLE_DIR, "demo-forest.png"),
        description: "Dense forest canopy",
        mime: "image/png",
    },
    {
        id: "demo-orchard",
        filePath: path.join(SAMPLE_DIR, "demo-orchard.png"),
        description: "Curated orchard rows",
        mime: "image/png",
    },
].filter((sample) => fs.existsSync(sample.filePath));

if (!SAMPLE_IMAGES.length) {
    console.warn(
        "Warning: no sample images found in sample-images/. Demo flight uploads will fail until at least one image is available.",
    );
}

const selectSample = (sampleId) => {
    if (!SAMPLE_IMAGES.length) {
        return null;
    }
    if (!sampleId) {
        return SAMPLE_IMAGES[0];
    }
    return (
        SAMPLE_IMAGES.find((sample) => sample.id === sampleId) ||
        SAMPLE_IMAGES[0]
    );
};

const cleanedImageServiceUrl = IMAGE_SERVICE_API.replace(/\/+$/, "");

async function uploadSampleImage(sample) {
    if (!cleanedImageServiceUrl) {
        throw new Error("IMAGE_SERVICE_API is not configured.");
    }
    const buffer = await fs.promises.readFile(sample.filePath);
    const blob = new Blob([buffer], { type: sample.mime });
    const formData = new FormData();
    formData.append(
        "image",
        blob,
        path.basename(sample.filePath) || `${sample.id}.png`,
    );
    const response = await fetch(cleanedImageServiceUrl, {
        method: "POST",
        body: formData,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `Image upload failed: ${response.status} ${text || "unknown error"}`,
        );
    }
    return response.json();
}

const trimmedThingUrl = DRONE_THING_URL.replace(/\/+$/, "");

async function invokeDroneAction(action, payload = {}) {
    if (!trimmedThingUrl) {
        return {
            action,
            skipped: true,
            message: "DRONE_THING_URL is not configured; skipping action.",
        };
    }
    const response = await fetch(`${trimmedThingUrl}/actions/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `Drone action ${action} failed (${response.status}): ${text || ""}`,
        );
    }
    return { action, success: true };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

app.post("/api/demo-flight", async (req, res) => {
    const { lat, lon, sampleId } = req.body || {};
    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
        return res.status(400).json({ error: "Invalid latitude" });
    }
    if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
        return res.status(400).json({ error: "Invalid longitude" });
    }

    const sample = selectSample(sampleId);
    if (!sample) {
        return res
            .status(500)
            .json({ error: "No demo samples available on the server." });
    }

    const droneLog = [];
    const trackAction = async (action, payload) => {
        try {
            const result = await invokeDroneAction(action, payload);
            droneLog.push(result);
        } catch (error) {
            droneLog.push({
                action,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    try {
        await trackAction("arm");
        await trackAction("takeoff", { alt: DEMO_TAKEOFF_ALT });
        await sleep(1000);
        await trackAction("goto", {
            lat: latNum,
            lon: lonNum,
            alt: DEMO_TAKEOFF_ALT,
        });
        await sleep(TAKE_PHOTO_DELAY_MS);

        const uploadResult = await uploadSampleImage(sample);

        res.json({
            status: "ok",
            lat: latNum,
            lon: lonNum,
            sampleId: sample.id,
            sampleDescription: sample.description,
            demoImage: uploadResult,
            imageUrl: uploadResult?.url,
            droneLog,
            message:
                "Drone demo completed. Sample capture uploaded and ready for analysis.",
        });
    } catch (error) {
        console.error("Demo flight failed", error);
        res.status(500).json({
            error: "Demo flight failed",
            details: error instanceof Error ? error.message : String(error),
        });
    }
});

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

        // Invia i dati al modulo di clustering
        try {
            const clusteringResponse = await fetch(CLUSTERING_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    content: [
                        {
                            text: JSON.stringify(sam3Segmentations),
                        },
                    ],
                }),
            });

            if (clusteringResponse.ok) {
                console.log("[Clustering] Dati inviati con successo");
            } else {
                console.warn(
                    "[Clustering] Errore nell'invio:",
                    await clusteringResponse.text(),
                );
            }
        } catch (clusteringError) {
            console.error(
                "[Clustering] Impossibile inviare i dati:",
                clusteringError.message,
            );
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
