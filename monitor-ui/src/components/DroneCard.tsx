import { FormEvent, useState } from "react";
import type { ActionState, DroneSnapshot } from "../types";

interface DroneCardProps {
    drone: DroneSnapshot;
    actionState?: ActionState;
    onAction: (action: string, payload?: unknown) => Promise<void> | void;
}

function formatCoord(value?: number) {
    if (value == null) return "—";
    return value.toFixed(6);
}

function formatAlt(value?: number) {
    if (value == null) return "—";
    return `${value.toFixed(1)} m`;
}

function formatSpeed(value?: number) {
    if (value == null) return "—";
    return `${value.toFixed(1)} m/s`;
}

const DroneCard = ({ drone, actionState, onAction }: DroneCardProps) => {
    const [takeoffAlt, setTakeoffAlt] = useState<string>("10");
    const [gotoForm, setGotoForm] = useState({
        lat: "",
        lon: "",
        alt: "",
    });
    const [speedValue, setSpeedValue] = useState<string>("");
    const [batteryForm, setBatteryForm] = useState({
        remaining: "",
        voltage: "",
        current: "",
    });
    const [isBatteryModalOpen, setBatteryModalOpen] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const statusClass = drone.armed ? "status armed" : "status idle";
    const lastUpdated = drone.lastUpdated
        ? new Date(drone.lastUpdated).toLocaleTimeString()
        : "—";

    function submitTakeoff(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const parsed = Number(takeoffAlt);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setFormError("Takeoff altitude must be a positive number");
            return;
        }
        setFormError(null);
        void onAction("takeoff", { alt: parsed });
    }

    function submitGoto(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const lat = Number(gotoForm.lat);
        const lon = Number(gotoForm.lon);
        const alt = Number(gotoForm.alt);
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            !Number.isFinite(alt)
        ) {
            setFormError("Enter valid coordinates and altitude");
            return;
        }
        setFormError(null);
        void onAction("goto", { lat, lon, alt });
    }

    function submitSpeed(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!speedValue.trim()) {
            setFormError("Speed cannot be empty");
            return;
        }
        const parsed = Number(speedValue);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setFormError("Speed must be a positive number");
            return;
        }
        setFormError(null);
        void onAction("setSpeed", { type: "ground", speed: parsed });
    }

    function openBatteryModal() {
        setBatteryForm({
            remaining:
                drone.battery?.remaining != null
                    ? String(drone.battery.remaining)
                    : "",
            voltage:
                drone.battery?.voltage != null
                    ? String(drone.battery.voltage)
                    : "",
            current:
                drone.battery?.current != null
                    ? String(drone.battery.current)
                    : "",
        });
        setBatteryModalOpen(true);
    }

    function closeBatteryModal() {
        setBatteryModalOpen(false);
        setFormError(null);
    }

    function submitBattery(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const remaining =
            batteryForm.remaining.trim() === ""
                ? undefined
                : Number(batteryForm.remaining);
        const voltage =
            batteryForm.voltage.trim() === ""
                ? undefined
                : Number(batteryForm.voltage);
        const current =
            batteryForm.current.trim() === ""
                ? undefined
                : Number(batteryForm.current);
        if (
            remaining != null &&
            (!Number.isFinite(remaining) || remaining < 0 || remaining > 100)
        ) {
            setFormError("Percentage must be between 0 and 100");
            return;
        }
        if (voltage != null && !Number.isFinite(voltage)) {
            setFormError("Voltage must be a number");
            return;
        }
        if (current != null && !Number.isFinite(current)) {
            setFormError("Current must be a number");
            return;
        }
        setFormError(null);
        void onAction("simulateBattery", {
            active: true,
            remaining,
            voltage,
            current,
        });
        closeBatteryModal();
    }

    function clearBatteryOverride() {
        void onAction("simulateBattery", { active: false });
        closeBatteryModal();
    }

    return (
        <article className="drone-card">
            <header className="drone-card__header">
                <div>
                    <div className="drone-card__title-row">
                        <h2>{drone.label}</h2>
                        <span className={statusClass}>
                            {drone.armed ? "Armed" : "Idle"}
                        </span>
                    </div>
                    <p className="drone-card__subtitle">{drone.mode || "—"}</p>
                </div>
                <div className="drone-card__meta">
                    <span>Last update</span>
                    <strong>{lastUpdated}</strong>
                </div>
            </header>

            {drone.error ? (
                <p className="drone-card__error">
                    Unable to reach servient: {drone.error}
                </p>
            ) : (
                <>
                    <dl className="telemetry">
                        <div>
                            <dt>Latitude</dt>
                            <dd>{formatCoord(drone.position?.lat)}</dd>
                        </div>
                        <div>
                            <dt>Longitude</dt>
                            <dd>{formatCoord(drone.position?.lon)}</dd>
                        </div>
                        <div>
                            <dt>Altitude</dt>
                            <dd>{formatAlt(drone.position?.alt)}</dd>
                        </div>
                        <div>
                            <dt>Groundspeed</dt>
                            <dd>{formatSpeed(drone.groundspeed)}</dd>
                        </div>
                    </dl>
                    <p className="servient-endpoint">
                        <span>Servient</span>{" "}
                        <a
                            href={drone.thingUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {drone.thingUrl}
                        </a>
                    </p>
                    <div className="battery-summary">
                        <button
                            type="button"
                            className="battery-chip"
                            onClick={openBatteryModal}
                            disabled={drone.error != null}
                        >
                            Battery:{" "}
                            {drone.battery?.remaining != null
                                ? `${drone.battery.remaining.toFixed(0)}%`
                                : "—"}
                        </button>
                        <span>
                            {drone.battery?.voltage != null
                                ? `${drone.battery.voltage.toFixed(1)} V`
                                : "— V"}
                        </span>
                        <span>
                            {drone.battery?.current != null
                                ? `${drone.battery.current.toFixed(1)} A`
                                : "— A"}
                        </span>
                    </div>
                </>
            )}

            <div className="actions">
                <div className="actions__row">
                    <button
                        type="button"
                        onClick={() => onAction("arm")}
                        disabled={drone.error != null}
                    >
                        Arm
                    </button>
                    <button
                        type="button"
                        onClick={() => onAction("setMode", "GUIDED")}
                        disabled={drone.error != null}
                    >
                        Guided
                    </button>
                    <button
                        type="button"
                        onClick={() => onAction("disarm")}
                        disabled={drone.error != null}
                    >
                        Disarm
                    </button>
                    <button
                        type="button"
                        onClick={() => onAction("rtl")}
                        disabled={drone.error != null}
                    >
                        RTL
                    </button>
                    <button
                        type="button"
                        onClick={() => onAction("land")}
                        disabled={drone.error != null}
                    >
                        Land
                    </button>
                </div>

                <form className="actions__row" onSubmit={submitTakeoff}>
                    <label>
                        Takeoff alt (m)
                        <input
                            type="number"
                            min={1}
                            step="1"
                            value={takeoffAlt}
                            onChange={(event) =>
                                setTakeoffAlt(event.target.value)
                            }
                            placeholder="10"
                        />
                    </label>
                    <button type="submit" disabled={drone.error != null}>
                        Takeoff
                    </button>
                </form>

                <form className="actions__row" onSubmit={submitSpeed}>
                    <label>
                        Target speed (m/s)
                        <input
                            type="number"
                            step="any"
                            min={0}
                            value={speedValue}
                            onChange={(event) =>
                                setSpeedValue(event.target.value)
                            }
                            placeholder="10"
                        />
                    </label>
                    <button type="submit" disabled={drone.error != null}>
                        Set speed
                    </button>
                </form>

                <form className="goto-form" onSubmit={submitGoto}>
                    <label>
                        Lat
                        <input
                            type="number"
                            step="any"
                            value={gotoForm.lat}
                            onChange={(event) =>
                                setGotoForm((prev) => ({
                                    ...prev,
                                    lat: event.target.value,
                                }))
                            }
                            placeholder="44.494"
                        />
                    </label>
                    <label>
                        Lon
                        <input
                            type="number"
                            step="any"
                            value={gotoForm.lon}
                            onChange={(event) =>
                                setGotoForm((prev) => ({
                                    ...prev,
                                    lon: event.target.value,
                                }))
                            }
                            placeholder="11.342"
                        />
                    </label>
                    <label>
                        Alt (m)
                        <input
                            type="number"
                            step="any"
                            value={gotoForm.alt}
                            onChange={(event) =>
                                setGotoForm((prev) => ({
                                    ...prev,
                                    alt: event.target.value,
                                }))
                            }
                            placeholder="20"
                        />
                    </label>
                    <button type="submit" disabled={drone.error != null}>
                        Goto
                    </button>
                </form>
                {formError && <p className="form-error">{formError}</p>}
                {actionState && (
                    <p className={`action-state ${actionState.status}`}>
                        {actionState.lastAction?.toUpperCase()}:{" "}
                        {actionState.message}
                    </p>
                )}
            </div>

            {isBatteryModalOpen && (
                <div className="modal-backdrop" onClick={closeBatteryModal}>
                    <div
                        className="modal-card"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3>Battery override</h3>
                        <form className="modal-form" onSubmit={submitBattery}>
                            <label>
                                Remaining (%)
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={batteryForm.remaining}
                                    onChange={(event) =>
                                        setBatteryForm((prev) => ({
                                            ...prev,
                                            remaining: event.target.value,
                                        }))
                                    }
                                />
                            </label>
                            <label>
                                Voltage (V)
                                <input
                                    type="number"
                                    step="any"
                                    value={batteryForm.voltage}
                                    onChange={(event) =>
                                        setBatteryForm((prev) => ({
                                            ...prev,
                                            voltage: event.target.value,
                                        }))
                                    }
                                />
                            </label>
                            <label>
                                Current (A)
                                <input
                                    type="number"
                                    step="any"
                                    value={batteryForm.current}
                                    onChange={(event) =>
                                        setBatteryForm((prev) => ({
                                            ...prev,
                                            current: event.target.value,
                                        }))
                                    }
                                />
                            </label>
                            {formError && (
                                <p className="form-error">{formError}</p>
                            )}
                            <div className="modal-actions">
                                <button type="submit">Apply</button>
                                <button
                                    type="button"
                                    onClick={clearBatteryOverride}
                                >
                                    Clear override
                                </button>
                                <button
                                    type="button"
                                    className="ghost"
                                    onClick={closeBatteryModal}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </article>
    );
};

export default DroneCard;
