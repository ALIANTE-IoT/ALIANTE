import type { ServientConfig } from "./types";

const DEFAULT_SERVIENTS: ServientConfig[] = [
    {
        id: "drone1",
        label: "Drone 1",
        thingUrl: "http://localhost:19080/drone1-thing",
    },
    {
        id: "drone2",
        label: "Drone 2",
        thingUrl: "http://localhost:19081/drone2-thing",
    },
    {
        id: "drone3",
        label: "Drone 3",
        thingUrl: "http://localhost:19082/drone3-thing",
    },
];

function parseServientLine(line: string): ServientConfig | null {
    const [idAndLabel, url] = line.split("=");
    if (!idAndLabel || !url) return null;
    const [id, labelOverride] = idAndLabel.split("|").map((s) => s.trim());
    const thingUrl = url.trim();
    if (!id || !thingUrl) return null;
    return {
        id,
        label: labelOverride || id,
        thingUrl,
    };
}

function parseServientConfig(): ServientConfig[] {
    const raw = import.meta.env.VITE_SERVIENTS;
    if (!raw || typeof raw !== "string") {
        return DEFAULT_SERVIENTS;
    }
    const items = raw
        .split(",")
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map(parseServientLine)
        .filter((item): item is ServientConfig => Boolean(item));

    return items.length > 0 ? items : DEFAULT_SERVIENTS;
}

export const SERVIENTS: ServientConfig[] = parseServientConfig();
export const POLL_INTERVAL_MS =
    Number(import.meta.env.VITE_POLL_INTERVAL_MS || "2000") || 2000;
