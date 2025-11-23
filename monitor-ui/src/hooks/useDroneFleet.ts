import { useCallback, useEffect, useState } from "react";
import { SERVIENTS, POLL_INTERVAL_MS } from "../config";
import { fetchDroneSnapshot } from "../api/servients";
import type { DroneSnapshot } from "../types";

export function useDroneFleet(pollMs: number = POLL_INTERVAL_MS) {
    const [drones, setDrones] = useState<DroneSnapshot[]>(
        SERVIENTS.map((config) => ({ ...config })),
    );
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

    const refresh = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const snapshots = await Promise.all(
                SERVIENTS.map((config) => fetchDroneSnapshot(config)),
            );
            setDrones(snapshots);
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        if (pollMs <= 0) return;
        const timer = window.setInterval(() => {
            refresh();
        }, pollMs);

        return () => window.clearInterval(timer);
    }, [pollMs, refresh]);

    return { drones, refresh, isRefreshing };
}
