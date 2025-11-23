import { useMemo, useState } from "react";
import "./App.css";

const DEFAULT_ENDPOINT = "http://localhost:4000/api/tree-analysis";

const formatClusterLabel = (
    { species_group, count, confidence, notes },
    index,
) => {
    const name = species_group || `Cluster ${index + 1}`;
    const quantity =
        typeof count === "number"
            ? `${count} tree${count === 1 ? "" : "s"}`
            : "Unknown count";
    const certainty = confidence
        ? `${confidence} confidence`
        : "confidence unknown";
    return `${name} • ${quantity} • ${certainty}${notes ? ` – ${notes}` : ""}`;
};

function App() {
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [status, setStatus] = useState("Drop a drone image to get started.");
    const [error, setError] = useState("");
    const [analysis, setAnalysis] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const endpoint = useMemo(() => {
        return import.meta.env.VITE_TREE_ANALYZER_API ?? DEFAULT_ENDPOINT;
    }, []);

    const handleFileChange = (event) => {
        setError("");
        setAnalysis(null);
        const file = event.target.files?.[0];

        if (!file) {
            setSelectedFile(null);
            setPreviewUrl("");
            return;
        }

        if (!file.type.startsWith("image/")) {
            setError("Only images are supported.");
            return;
        }

        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setStatus(`Ready to analyze ${file.name}`);
    };

    const handleUpload = async () => {
        if (!selectedFile) {
            setError("Please choose an image captured by the drone first.");
            return;
        }

        setIsLoading(true);
        setError("");
        setStatus("Contacting biodiversity analyst...");

        try {
            const formData = new FormData();
            formData.append("image", selectedFile);

            const response = await fetch(endpoint, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const details = await response.json().catch(() => ({}));
                throw new Error(
                    details?.error || "Failed to analyze the image.",
                );
            }

            const payload = await response.json();
            setAnalysis(payload);
            setStatus(
                "Analysis completed. Review the biodiversity insights below.",
            );
        } catch (err) {
            console.error("Upload failed", err);
            setError(err.message || "Unknown error during upload.");
            setStatus("Upload failed. Try another image.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="app-shell">
            <header>
                <h1>Drone Biodiversity Analyst</h1>
                <p>
                    Upload a drone shot to estimate how many trees are present
                    and how they cluster by species.
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

                <button
                    type="button"
                    onClick={handleUpload}
                    disabled={isLoading}
                >
                    {isLoading ? "Analyzing..." : "Run Analysis"}
                </button>
                <p className="status">{status}</p>
                {error && <p className="error">{error}</p>}
            </section>

            {analysis && (
                <section className="results">
                    <h2>Findings</h2>
                    <div className="stat">
                        <span className="label">Detected Trees</span>
                        <span className="value">
                            {analysis.treeCount ?? "Unknown"}
                        </span>
                    </div>
                    <div className="stat">
                        <span className="label">Model</span>
                        <span className="value">{analysis.model}</span>
                    </div>

                    {analysis.speciesClusters?.length ? (
                        <ul>
                            {analysis.speciesClusters.map((cluster, idx) => (
                                <li
                                    key={`${cluster.species_group || idx}-${idx}`}
                                >
                                    {formatClusterLabel(cluster, idx)}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>No species clusters reported.</p>
                    )}

                    {analysis.reasoning && (
                        <div className="reasoning">
                            <h3>Model Rationale</h3>
                            <p>{analysis.reasoning}</p>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}

export default App;
