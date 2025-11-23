import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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

const promptTemplate = `You are a biodiversity analyst assisting an insurance inspector.
Given a drone photo URL and a short request from the inspector, produce JSON with this schema:
{
  "focus": string, // what ecosystem component you focused on
  "summary": string,
  "observations": string[],
  "recommended_actions": string[]
}`;

const buildAnalysis = (parsed, fallbackText, prompt) => ({
    focus: parsed?.focus || prompt,
    summary: parsed?.summary || fallbackText,
    observations: normalizeList(parsed?.observations),
    recommendedActions: normalizeList(
        parsed?.recommended_actions || parsed?.recommendations,
    ),
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
                        { type: "input_text", text: prompt },
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
            analysis: buildAnalysis(parsed, text, prompt),
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
