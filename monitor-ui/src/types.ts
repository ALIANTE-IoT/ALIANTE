export interface ServientConfig {
    id: string;
    label: string;
    thingUrl: string;
}

export interface Position {
    lat: number;
    lon: number;
    alt: number;
}

export interface DroneSnapshot extends ServientConfig {
    armed?: boolean;
    mode?: string;
    position?: Position;
    groundspeed?: number;
    battery?: BatteryInfo;
    lastUpdated?: number;
    error?: string;
}

export interface ActionRequest {
    name: string;
    payload?: Record<string, unknown>;
}

export interface ActionState {
    status: "idle" | "pending" | "success" | "error";
    lastAction?: string;
    message?: string;
}

export interface BatteryInfo {
    voltage?: number;
    current?: number | null;
    remaining?: number | null;
    temperature?: number | null;
    consumedMah?: number | null;
    status?: string;
}
