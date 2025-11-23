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
    const [targetLat, setTargetLat] = useState("44.4940");
    const [targetLon, setTargetLon] = useState("11.3420");
    const [isFlying, setIsFlying] = useState(false);
    const [flightStatus, setFlightStatus] = useState("");

    const analyzerEndpoint = useMemo(() => {
        return (
            import.meta.env.VITE_TREE_ANALYZER_API ?? DEFAULT_ANALYZER_ENDPOINT
        );
    }, []);

    const imageEndpoint = useMemo(() => {
        return import.meta.env.VITE_IMAGE_SERVICE_API ?? DEFAULT_IMAGE_ENDPOINT;
    }, []);

    const analyzerBase = useMemo(() => {
        const override = import.meta.env.VITE_TREE_ANALYZER_BASE;
        if (override) return override.replace(/\/$/, "");
        const idx = analyzerEndpoint.indexOf("/api/");
        if (idx >= 0) {
            return analyzerEndpoint.slice(0, idx);
        }
        return analyzerEndpoint.replace(/\/$/, "");
    }, [analyzerEndpoint]);

    const resetUpload = () => {
        setImageUrl("");
        setAnalysis(null);
        setUploadMessage("Ready to upload a new snapshot.");
        setFlightStatus("");
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
        if (!selectedFile) {
            throw new Error("No image available for upload.");
        }
        return uploadImage();
    };

    const handleAnalyze = async () => {
        if (!prompt.trim()) {
            setError("Please describe which biodiversity aspect to analyze.");
            return;
        }
        if (!selectedFile && !imageUrl) {
            setError("Please select or capture a drone image first.");
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
            setIsAnalyzing(false);
        }
    };

    const currentAnalysis = analysis?.analysis;
    const segmentationPayload =
        analysis?.sam3Segmentations ?? currentAnalysis?.sam3Segmentations;

    const renderSegmentationPayload = () => {
        if (!segmentationPayload) {
            return <p>No segmentation metadata available.</p>;
        }

        const serialized =
            typeof segmentationPayload === "string"
                ? segmentationPayload
                : JSON.stringify(segmentationPayload, null, 2);

        return <pre className="json-block">{serialized}</pre>;
    };

    const handleSimulatedCapture = async () => {
        const latNum = Number(targetLat);
        const lonNum = Number(targetLon);
        if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
            setError("Latitude must be between -90 and 90 degrees.");
            return;
        }
        if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
            setError("Longitude must be between -180 and 180 degrees.");
            return;
        }
        setError("");
        setAnalysis(null);
        setIsFlying(true);
        setUploadMessage("Simulating drone flight...");
        setFlightStatus("Arming drone and moving to coordinates...");
        try {
            const response = await fetch(`${analyzerBase}/api/demo-flight`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lat: latNum,
                    lon: lonNum,
                }),
            });
            if (!response.ok) {
                const details = await response.json().catch(() => ({}));
                throw new Error(details?.error || "Demo flight failed.");
            }
            const payload = await response.json();
            if (payload?.imageUrl) {
                setImageUrl(payload.imageUrl);
                setPreviewUrl(payload.imageUrl);
                setSelectedFile(null);
                setUploadMessage(
                    "Sample image captured via drone demo. Ready for analysis.",
                );
            }
            setFlightStatus(payload?.message || "Drone demo completed.");
            if (payload?.droneLog?.length) {
                console.table?.(payload.droneLog);
            }
        } catch (err) {
            console.error("Demo flight failed", err);
            setError(err.message || "Demo flight failed.");
            setFlightStatus("Demo flight failed.");
        } finally {
            setIsFlying(false);
        }
    };

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
                        <small>{selectedFile?.name || "Demo capture"}</small>
                    </div>
                )}

                <div className="flight-controls">
                    <div>
                        <h3>Simulated Drone Capture</h3>
                        <p className="helper">
                            Enter target coordinates and let the demo drone arm,
                            fly, and capture a sample frame automatically.
                        </p>
                    </div>
                    <div className="coord-row">
                        <label>
                            Latitude
                            <input
                                type="number"
                                step="0.0001"
                                value={targetLat}
                                onChange={(e) => setTargetLat(e.target.value)}
                            />
                        </label>
                        <label>
                            Longitude
                            <input
                                type="number"
                                step="0.0001"
                                value={targetLon}
                                onChange={(e) => setTargetLon(e.target.value)}
                            />
                        </label>
                    </div>
                    <button
                        type="button"
                        onClick={handleSimulatedCapture}
                        disabled={isFlying || isAnalyzing || isUploading}
                    >
                        {isFlying ? "Flying & Capturing..." : "Fly & Capture"}
                    </button>
                    {flightStatus && (
                        <p className="flight-status">{flightStatus}</p>
                    )}
                </div>

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

                    <div className="json-section">
                        <h3>SAM3 Segmentations</h3>
                        {renderSegmentationPayload()}
                    </div>

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
