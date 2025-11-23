import { FormEvent, useCallback, useState } from "react";
import "./App.css";
import { useDroneFleet } from "./hooks/useDroneFleet";
import { invokeAction } from "./api/servients";
import type { ActionState, DroneSnapshot } from "./types";
import DroneCard from "./components/DroneCard";
import { POLL_INTERVAL_MS } from "./config";

type ActionStateMap = Record<string, ActionState>;

function App() {
    const [pollMs, setPollMs] = useState<number>(POLL_INTERVAL_MS);
    const [pollInput, setPollInput] = useState<string>(
        String(POLL_INTERVAL_MS),
    );
    const { drones, refresh, isRefreshing } = useDroneFleet(pollMs);
    const [actionState, setActionState] = useState<ActionStateMap>({});

    const runAction = useCallback(
        async (drone: DroneSnapshot, action: string, payload?: unknown) => {
            setActionState((prev) => ({
                ...prev,
                [drone.id]: {
                    status: "pending",
                    lastAction: action,
                    message: "Sending command…",
                },
            }));
            try {
                await invokeAction(drone, action, payload);
                setActionState((prev) => ({
                    ...prev,
                    [drone.id]: {
                        status: "success",
                        lastAction: action,
                        message: "Servient acknowledged",
                    },
                }));
                await refresh();
            } catch (error) {
                setActionState((prev) => ({
                    ...prev,
                    [drone.id]: {
                        status: "error",
                        lastAction: action,
                        message:
                            error instanceof Error
                                ? error.message
                                : "Action failed",
                    },
                }));
            }
        },
        [refresh],
    );

    function submitPoll(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const parsed = Number(pollInput);
        if (!Number.isFinite(parsed)) return;
        const safe = Math.max(250, parsed);
        setPollMs(safe);
        setPollInput(String(safe));
    }

    return (
        <div className="app-shell">
            <header className="app-header">
                <div>
                    <p className="eyebrow">WoTs-Up-There</p>
                    <h1>Swarm monitor</h1>
                </div>
                <div className="header-controls">
                    <form className="poll-form" onSubmit={submitPoll}>
                        <label>
                            Polling (ms)
                            <input
                                type="number"
                                min={250}
                                step="100"
                                value={pollInput}
                                onChange={(event) =>
                                    setPollInput(event.target.value)
                                }
                            />
                        </label>
                        <button type="submit">Apply</button>
                    </form>
                    <button
                        type="button"
                        className="refresh-btn"
                        onClick={refresh}
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? "Refreshing…" : "Refresh now"}
                    </button>
                </div>
            </header>
            <main className="fleet-grid">
                {drones.map((drone) => (
                    <DroneCard
                        key={drone.id}
                        drone={drone}
                        actionState={actionState[drone.id]}
                        onAction={(action, payload) =>
                            runAction(drone, action, payload)
                        }
                    />
                ))}
            </main>
        </div>
    );
}

export default App;
