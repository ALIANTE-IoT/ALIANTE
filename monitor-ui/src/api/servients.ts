import type {
    BatteryInfo,
    DroneSnapshot,
    Position,
    ServientConfig,
} from "../types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || response.statusText);
    }
    if (response.status === 204) {
        return {} as T;
    }
    return (await response.json()) as T;
}

async function fetchProperty<T>(
    config: ServientConfig,
    property: string,
): Promise<T> {
    return fetchJson<T>(`${config.thingUrl}/properties/${property}`);
}

export async function fetchDroneSnapshot(
    config: ServientConfig,
): Promise<DroneSnapshot> {
    try {
        const [armed, mode, position, groundspeed, battery] = await Promise.all(
            [
                fetchProperty<boolean>(config, "armed"),
                fetchProperty<string>(config, "mode"),
                fetchProperty<Position>(config, "position"),
                fetchProperty<number>(config, "groundspeed"),
                fetchProperty<BatteryInfo>(config, "battery"),
            ],
        );

        return {
            ...config,
            armed,
            mode,
            position,
            groundspeed,
            battery,
            lastUpdated: Date.now(),
            error: undefined,
        };
    } catch (error) {
        return {
            ...config,
            error:
                error instanceof Error
                    ? error.message
                    : "Unable to reach servient",
        };
    }
}

export async function invokeAction(
    config: ServientConfig,
    action: string,
    payload?: unknown,
): Promise<void> {
    const body =
        payload !== undefined ? JSON.stringify(payload) : JSON.stringify({});
    await fetchJson(`${config.thingUrl}/actions/${action}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body,
    });
}
