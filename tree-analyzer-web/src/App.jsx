import { useMemo, useState } from "react";
import "./App.css";

const DEFAULT_ANALYZER_ENDPOINT = "http://localhost:4000/api/biodiversity";
const DEFAULT_IMAGE_ENDPOINT = "http://localhost:4100/api/images";

function App() {
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [uploadMessage, setUploadMessage] = useState(
        "Drop a drone image to get started.",
    );
    const [prompt, setPrompt] = useState(
        "Assess biodiversity of the forest canopy and highlight key species.",
    );
    const [analysis, setAnalysis] = useState(null);
    const [error, setError] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const analyzerEndpoint = useMemo(() => {
        return (
            import.meta.env.VITE_TREE_ANALYZER_API ?? DEFAULT_ANALYZER_ENDPOINT
        );
    }, []);

    const imageEndpoint = useMemo(() => {
        return import.meta.env.VITE_IMAGE_SERVICE_API ?? DEFAULT_IMAGE_ENDPOINT;
    }, []);

    const resetUpload = () => {
        setImageUrl("");
        setAnalysis(null);
        setUploadMessage("Ready to upload a new snapshot.");
    };

    const handleFileChange = (event) => {
        setError("");
        const file = event.target.files?.[0];
        if (!file) {
            setSelectedFile(null);
            setPreviewUrl("");
            resetUpload();
            return;
        }
        if (!file.type.startsWith("image/")) {
            setError("Only images are supported.");
            return;
        }
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        resetUpload();
        setUploadMessage(`Selected ${file.name}`);
    };

    const uploadImage = async () => {
        if (!selectedFile) {
            throw new Error("Please select an image first.");
        }
        setIsUploading(true);
        setUploadMessage("Uploading image to shared storage...");
        try {
            const formData = new FormData();
            formData.append("image", selectedFile);
            const response = await fetch(imageEndpoint, {
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                const details = await response.json().catch(() => ({}));
                throw new Error(details?.error || "Image upload failed.");
            }
            const payload = await response.json();
            setImageUrl(payload.url);
            setUploadMessage("Image hosted successfully.");
            return payload.url;
        } finally {
            setIsUploading(false);
        }
    };

    const ensureUploadedUrl = async () => {
        if (imageUrl) return imageUrl;
        return uploadImage();
    };

    const handleAnalyze = async () => {
        if (!prompt.trim()) {
            setError("Please describe which biodiversity aspect to analyze.");
            return;
        }
        if (!selectedFile) {
            setError("Please select a drone image first.");
            return;
        }
        setError("");
        try {
            const hostedUrl = await ensureUploadedUrl();
            setIsAnalyzing(true);
            setUploadMessage("Contacting ChatGPT biodiversity analyst...");
            const response = await fetch(analyzerEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    imageUrl: hostedUrl,
                }),
            });
            if (!response.ok) {
                const details = await response.json().catch(() => ({}));
                throw new Error(details?.error || "Analysis failed.");
            }
            const payload = await response.json();
            setAnalysis(payload);
            setUploadMessage("Analysis completed.");
        } catch (err) {
            console.error("Analysis failed", err);
            setError(err.message || "Unknown error occurred.");
        } finally {
            setIsUploading(false);
            setIsAnalyzing(false);
        }
    };

    const currentAnalysis = analysis?.analysis;

    return (
        <div className="app-shell">
            <header>
                <h1>Drone Biodiversity Analyst</h1>
                <p>
                    Upload a snapshot, host it on the shared image server, add a
                    custom biodiversity prompt, and let ChatGPT summarize what
                    it sees.
                </p>
            </header>

            <section className="upload-panel">
                <label className="file-label" htmlFor="tree-image">
                    <span>Choose drone snapshot</span>
                    <input
                        id="tree-image"
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                    />
                </label>

                {previewUrl && (
                    <div className="preview">
                        <img src={previewUrl} alt="Selected drone frame" />
                        <small>{selectedFile?.name}</small>
                    </div>
                )}

                {imageUrl && (
                    <p className="image-url">
                        Hosted at{" "}
                        <a href={imageUrl} target="_blank" rel="noreferrer">
                            {imageUrl}
                        </a>
                    </p>
                )}

                <label className="prompt-label" htmlFor="prompt-box">
                    Biodiversity prompt
                </label>
                <textarea
                    id="prompt-box"
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what you want the AI to focus on..."
                />

                <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={isUploading || isAnalyzing}
                >
                    {isAnalyzing || isUploading
                        ? "Working..."
                        : "Upload & Analyze"}
                </button>
                <p className="status">{uploadMessage}</p>
                {error && <p className="error">{error}</p>}
            </section>

            {currentAnalysis && (
                <section className="results">
                    <h2>Biodiversity Findings</h2>
                    <div className="stat">
                        <span className="label">Focus</span>
                        <span className="value">{currentAnalysis.focus}</span>
                    </div>
                    <p className="summary">{currentAnalysis.summary}</p>

                    {currentAnalysis.observations?.length > 0 && (
                        <div className="list-block">
                            <h3>Observations</h3>
                            <ul>
                                {currentAnalysis.observations.map(
                                    (item, idx) => (
                                        <li key={`${item}-${idx}`}>{item}</li>
                                    ),
                                )}
                            </ul>
                        </div>
                    )}

                    {currentAnalysis.recommendedActions?.length > 0 && (
                        <div className="list-block">
                            <h3>Recommended Actions</h3>
                            <ul>
                                {currentAnalysis.recommendedActions.map(
                                    (item, idx) => (
                                        <li key={`${item}-${idx}`}>{item}</li>
                                    ),
                                )}
                            </ul>
                        </div>
                    )}

                    <footer className="result-footer">
                        <span>Model: {analysis.model}</span>
                        <span>Prompt: {analysis.prompt}</span>
                    </footer>
                </section>
            )}
        </div>
    );
}

export default App;
