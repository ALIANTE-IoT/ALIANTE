// index.js — Servient (API v1 only, modes via COMMAND_LONG/DO_SET_MODE)
import wotCore from "@node-wot/core";
import httpBinding from "@node-wot/binding-http";
import axios from "axios";

const { Servient } = wotCore;
const { HttpServer } = httpBinding;

// env
const DRONE_NAME = process.env.DRONE_NAME || "drone";
const SYSID = Number(process.env.SYSID || "1");
const WOT_PORT = Number(process.env.WOT_PORT || "8080");
const M2R_BASE = (process.env.M2R_BASE || "http://drone1:8088").replace(
    /\/+$/,
    "",
);
const TDD_URL = (process.env.TDD_URL || "http://zion:3000").replace(/\/+$/, "");
const ZION_EMAIL = process.env.ZION_EMAIL || "";
const ZION_PASSWORD = process.env.ZION_PASSWORD || "";
let ZION_TOKEN = process.env.ZION_TOKEN || "";

// utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${DRONE_NAME}]`, ...a);
const jh = { headers: { "content-type": "application/json" } };

// ArduCopter mode map
const MODES = {
    STABILIZE: 0,
    ACRO: 1,
    ALT_HOLD: 2,
    AUTO: 3,
    GUIDED: 4,
    LOITER: 5,
    RTL: 6,
    CIRCLE: 7,
    LAND: 9,
};

// mavlink2rest v1 helpers
async function v1Helper(name) {
    const { data } = await axios.get(
        `${M2R_BASE}/v1/helper/mavlink?name=${encodeURIComponent(name)}`,
    );
    return data; // { header, message }
}
async function v1Post(msgObj) {
    await axios.post(`${M2R_BASE}/v1/mavlink`, msgObj, jh);
}
async function v1Last(name) {
    const { data } = await axios.get(
        `${M2R_BASE}/v1/mavlink/vehicles/${SYSID}/components/1/messages/${name}`,
    );
    return data; // { message, status }
}

// high-level ops on v1
function scalar(input) {
    if (input == null) return input;
    if (typeof input === "string" || typeof input === "number") return input;
    if (typeof input === "object") {
        for (const k of ["value", "mode", "input"]) {
            if (
                k in input &&
                (typeof input[k] === "string" || typeof input[k] === "number")
            ) {
                return input[k];
            }
        }
    }
    return input;
}
function modeToNumber(m) {
    if (typeof m === "number") return m;
    const key = String(m || "").toUpperCase();
    return MODES[key] ?? 0;
}

async function send_COMMAND_LONG(commandTypeString, p = []) {
    const t = await v1Helper("COMMAND_LONG");
    t.header.system_id = 255; // GCS
    t.header.component_id = 240; // MAV_COMP_ID_MISSIONPLANNER
    t.message.target_system = SYSID; // autopilot SYSID
    t.message.target_component = 1; // MAV_COMP_ID_AUTOPILOT1
    t.message.command = { type: commandTypeString };

    const [p1, p2, p3, p4, p5, p6, p7] = [...p, 0, 0, 0, 0, 0, 0].slice(0, 7);
    Object.assign(t.message, {
        confirmation: 0,
        param1: Number(p1),
        param2: Number(p2),
        param3: Number(p3),
        param4: Number(p4),
        param5: Number(p5),
        param6: Number(p6),
        param7: Number(p7),
    });

    try {
        await v1Post(t);
    } catch (err) {
        const status = err?.response?.status || err.message || err;
        const payload = (() => {
            try {
                return JSON.stringify(t);
            } catch {
                return "";
            }
        })();
        log(
            `COMMAND_LONG ${commandTypeString} failed:`,
            status,
            err?.response?.data ? JSON.stringify(err.response.data) : "",
            payload ? `payload=${payload}` : "",
        );
        throw err;
    }
}

async function send_MISSION_ITEM_INT({ lat, lon, alt, yaw, acceptance = 5 }) {
    const t = await v1Helper("MISSION_ITEM_INT");
    t.header.system_id = 255;
    t.header.component_id = 240;
    const msg = t.message;
    msg.target_system = SYSID;
    msg.target_component = 1;
    msg.seq = 0;
    msg.current = 2;
    msg.autocontinue = 0;
    msg.frame = { type: "MAV_FRAME_GLOBAL_RELATIVE_ALT_INT" };
    msg.command = { type: "MAV_CMD_NAV_WAYPOINT" };
    msg.param1 = 0;
    msg.param2 = Number(acceptance) || 5;
    msg.param3 = 0;
    msg.param4 = Number.isFinite(yaw) ? Number(yaw) : 0;
    msg.x = Math.round(Number(lat) * 1e7);
    msg.y = Math.round(Number(lon) * 1e7);
    msg.z = Number(alt);
    msg.mission_type = { type: "MAV_MISSION_TYPE_MISSION" };

    await v1Post(t);
}

// Mode change reliable via COMMAND_LONG / MAV_CMD_DO_SET_MODE
// param1: bitmask con CUSTOM_MODE_ENABLED (1). param2: custom_mode (ArduPilot)
async function doSetMode(input) {
    const custom = modeToNumber(scalar(input));
    await send_COMMAND_LONG("MAV_CMD_DO_SET_MODE", [1, custom, 0, 0, 0, 0, 0]);
}

// Zion auth (JWT)
async function registerToZion() {
    try {
        const { data } = await axios.post(`${TDD_URL}/auth/register`, {
            email: ZION_EMAIL,
            password: ZION_PASSWORD,
        });
        ZION_TOKEN = data?.accessToken || data?.token || "";
        log("Registered to Zion");
    } catch (e) {
        log(
            "Failed to register to Zion:",
            e?.response?.status || e.message,
            e?.response?.data || "",
        );
    }
}

let tokenExpiryTimer = null;
function decodeJwtExpSec(jwt) {
    try {
        const base = jwt.split(".")[1];
        const json = JSON.parse(
            Buffer.from(base, "base64url").toString("utf8"),
        );
        return Number(json.exp) || 0;
    } catch {
        return 0;
    }
}
function scheduleRefresh(token) {
    if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
    const expSec = decodeJwtExpSec(token);
    if (!expSec) return;
    const msUntilExp = expSec * 1000 - Date.now();
    const msUntilRefresh = Math.max(5000, msUntilExp - 60000);
    tokenExpiryTimer = setTimeout(async () => {
        ZION_TOKEN = "";
        try {
            await getZionToken();
            log("JWT refreshed");
        } catch (e) {
            log("JWT refresh failed:", e?.response?.status || e.message);
        }
    }, msUntilRefresh);
}
async function getZionToken() {
    if (ZION_TOKEN) return ZION_TOKEN;
    if (!ZION_EMAIL || !ZION_PASSWORD || !TDD_URL) return "";
    try {
        const { data } = await axios.post(
            `${TDD_URL}/auth`,
            { email: ZION_EMAIL, password: ZION_PASSWORD },
            jh,
        );
        const tok = data?.accessToken || "";
        if (tok) {
            ZION_TOKEN = tok;
            scheduleRefresh(tok);
            return tok;
        }
    } catch (e) {
        log(
            "Login failed:",
            e?.response?.status || e.message,
            e?.response?.data || "",
        );
        if (e?.response?.status === 401) await registerToZion();
    }
    return "";
}
function authHeaders() {
    return ZION_TOKEN ? { Authorization: `Bearer ${ZION_TOKEN}` } : {};
}

// Node-WoT server + Thing
const servient = new Servient();
servient.addServer(new HttpServer({ port: WOT_PORT }));

function unwrapActionInput(arg) {
    if (!arg || typeof arg !== "object") return undefined;
    // Skip pure form descriptors
    if ("form" in arg && !("value" in arg) && !("input" in arg)) {
        return undefined;
    }
    if ("input" in arg && typeof arg.input === "object") {
        return unwrapActionInput(arg.input);
    }
    if ("value" in arg && typeof arg.value === "object") {
        return unwrapActionInput(arg.value);
    }
    if ("payload" in arg && typeof arg.payload === "object") {
        return unwrapActionInput(arg.payload);
    }
    const symbolKeys = Object.getOwnPropertySymbols(arg);
    for (const sym of symbolKeys) {
        const candidate = unwrapActionInput(arg[sym]);
        if (candidate) return candidate;
    }
    return arg;
}

function extractActionPayload(...args) {
    for (const arg of args) {
        const unwrapped = unwrapActionInput(arg);
        if (
            unwrapped &&
            typeof unwrapped === "object" &&
            Object.keys(unwrapped).length
        ) {
            return unwrapped;
        }
    }
    return {};
}

(async () => {
    // quick sanity check: v1 helper reachable (fail fast)
    await v1Helper("HEARTBEAT").catch(() => {
        throw new Error(`mavlink2rest v1 not reachable at ${M2R_BASE}/v1`);
    });

    const WoT = await servient.start();

    // local cache for fast property reads
    const state = {
        armed: false,
        mode: "UNKNOWN",
        position: { lat: 0, lon: 0, alt: 0 },
        groundspeed: 0,
        battery: {
            voltage: 0,
            current: 0,
            remaining: null,
            temperature: null,
            consumedMah: null,
            status: "UNKNOWN",
        },
        batteryOverride: null,
    };

    const thing = await WoT.produce({
        title: `${DRONE_NAME}-thing`,
        id: `urn:dev:ops:drone:${SYSID}`,
        description: "ArduPilot (SITL) via mavlink2rest v1",
        securityDefinitions: { nosec_sc: { scheme: "nosec" } },
        security: ["nosec_sc"],
        properties: {
            armed: { type: "boolean", readOnly: true },
            mode: { type: "string", readOnly: true },
            position: {
                type: "object",
                readOnly: true,
                properties: {
                    lat: { type: "number" },
                    lon: { type: "number" },
                    alt: { type: "number" },
                },
            },
            groundspeed: { type: "number", readOnly: true },
            battery: {
                type: "object",
                readOnly: true,
                properties: {
                    voltage: { type: "number", description: "Volts" },
                    current: {
                        anyOf: [{ type: "number" }, { type: "null" }],
                        description: "Amps",
                    },
                    remaining: {
                        anyOf: [
                            { type: "number", minimum: 0, maximum: 100 },
                            { type: "null" },
                        ],
                        description: "Percent 0-100",
                    },
                    temperature: {
                        anyOf: [{ type: "number" }, { type: "null" }],
                        description: "Celsius",
                    },
                    consumedMah: {
                        anyOf: [{ type: "number" }, { type: "null" }],
                        description: "Consumed mAh",
                    },
                    status: { type: "string" },
                },
            },
        },
        actions: {
            arm: { description: "Arm the drone" },
            disarm: { description: "Disarm the drone" },
            takeoff: {
                description: "GUIDED takeoff to altitude (m AGL)",
                input: {
                    type: "object",
                    properties: { alt: { type: "number", minimum: 1 } },
                    required: ["alt"],
                },
            },
            setMode: {
                description: "Set flight mode (string o numero)",
                input: {}, // free: "GUIDED" | 4 | {"value":"GUIDED"}
            },
            setSpeed: {
                description: "Set target speed",
                input: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["ground", "air"],
                            default: "ground",
                        },
                        speed: { type: "number", minimum: 0 },
                        throttle: {
                            type: "number",
                            minimum: -1,
                            maximum: 100,
                            default: -1,
                        },
                    },
                    required: ["speed"],
                },
            },
            goto: {
                description: "GUIDED goto lat/lon/alt (m AGL)",
                input: {
                    type: "object",
                    properties: {
                        lat: { type: "number" },
                        lon: { type: "number" },
                        alt: { type: "number" },
                        yaw: { type: "number" },
                        speed: { type: "number", minimum: 0 },
                        acceptance: {
                            type: "number",
                            minimum: 1,
                            default: 5,
                            description: "Acceptance radius in meters",
                        },
                    },
                    required: ["lat", "lon", "alt"],
                },
            },
            rtl: { description: "Return-to-Launch" },
            land: { description: "Land" },
            setHome: {
                description: "Set home position (or current)",
                input: {
                    type: "object",
                    properties: {
                        useCurrent: { type: "boolean", default: false },
                        lat: { type: "number" },
                        lon: { type: "number" },
                        alt: { type: "number" },
                    },
                },
            },
            setYaw: {
                description: "Rotate to yaw (deg)",
                input: {
                    type: "object",
                    properties: {
                        yaw: { type: "number" },
                        speed: { type: "number", default: 20 },
                        direction: {
                            type: "integer",
                            enum: [-1, 1],
                            default: 1,
                        },
                        relative: { type: "boolean", default: false },
                    },
                    required: ["yaw"],
                },
            },
            simulateBattery: {
                description: "Override battery telemetry for testing",
                input: {
                    type: "object",
                    properties: {
                        active: { type: "boolean", default: true },
                        voltage: { type: "number" },
                        current: { type: "number" },
                        remaining: {
                            anyOf: [
                                { type: "number", minimum: 0, maximum: 100 },
                                { type: "null" },
                            ],
                        },
                        temperature: {
                            anyOf: [{ type: "number" }, { type: "null" }],
                        },
                        consumedMah: {
                            anyOf: [{ type: "number" }, { type: "null" }],
                        },
                        status: { type: "string" },
                    },
                },
            },
        },
    });

    // property read handlers (serve cached)
    thing.setPropertyReadHandler("armed", async () => state.armed);
    thing.setPropertyReadHandler("mode", async () => state.mode);
    thing.setPropertyReadHandler("position", async () => state.position);
    thing.setPropertyReadHandler("groundspeed", async () => state.groundspeed);
    thing.setPropertyReadHandler(
        "battery",
        async () => state.batteryOverride || state.battery,
    );

    // actions
    thing.setActionHandler("arm", async () =>
        send_COMMAND_LONG("MAV_CMD_COMPONENT_ARM_DISARM", [1]),
    );
    thing.setActionHandler("disarm", async () =>
        send_COMMAND_LONG("MAV_CMD_COMPONENT_ARM_DISARM", [0]),
    );

    thing.setActionHandler("setMode", async (input) => {
        await doSetMode(input); // e.g. "GUIDED" or 4
    });

    thing.setActionHandler("takeoff", async ({ alt }) => {
        await doSetMode("GUIDED");
        await sleep(150);
        // param7 = altitude (m AGL)
        await send_COMMAND_LONG("MAV_CMD_NAV_TAKEOFF", [
            0,
            0,
            0,
            0,
            0,
            0,
            alt || 10,
        ]);
    });

    thing.setActionHandler("setSpeed", async (input) => {
        let payload = input;
        if (payload && typeof payload.value === "function") {
            payload = await payload.value();
        }
        if (payload == null || typeof payload !== "object") {
            payload = {};
        }
        const { type = "ground", speed, throttle = -1 } = payload;
        const stype = type === "air" ? 0 : 1;
        const speedNum = Number(speed);
        if (!Number.isFinite(speedNum) || speedNum <= 0) {
            throw new Error("Speed must be a positive number");
        }
        const throttleNum = Number(throttle);
        await send_COMMAND_LONG("MAV_CMD_DO_CHANGE_SPEED", [
            stype,
            speedNum,
            Number.isFinite(throttleNum) ? throttleNum : -1,
            0,
            0,
            0,
            0,
        ]);
    });

    thing.setActionHandler("goto", async (input) => {
        let payload = input;
        if (payload && typeof payload.value === "function") {
            payload = await payload.value();
        }
        if (payload == null || typeof payload !== "object") {
            payload = {};
        }
        const { lat, lon, alt, yaw, speed, acceptance = 5 } = payload;
        const latNum = Number(lat);
        const lonNum = Number(lon);
        const altNum = Number(alt);
        const yawNum =
            yaw == null || Number.isNaN(Number(yaw)) ? undefined : Number(yaw);
        if (
            !Number.isFinite(latNum) ||
            !Number.isFinite(lonNum) ||
            !Number.isFinite(altNum)
        ) {
            throw new Error("lat/lon/alt must be valid numbers");
        }
        if (Number.isFinite(speed) && Number(speed) > 0) {
            await send_COMMAND_LONG("MAV_CMD_DO_CHANGE_SPEED", [
                0,
                Number(speed),
                -1,
                0,
                0,
                0,
                0,
            ]);
        }
        await doSetMode("GUIDED");
        await sleep(100);
        await send_MISSION_ITEM_INT({
            lat: latNum,
            lon: lonNum,
            alt: altNum,
            yaw: yawNum,
            acceptance,
        });
    });

    thing.setActionHandler("rtl", async () => {
        await doSetMode("RTL");
    });

    thing.setActionHandler("land", async () => {
        await doSetMode("LAND");
    });

    thing.setActionHandler(
        "setHome",
        async ({ useCurrent = false, lat, lon, alt }) => {
            if (useCurrent) {
                await send_COMMAND_LONG(
                    "MAV_CMD_DO_SET_HOME",
                    [1, 0, 0, 0, 0, 0, 0],
                );
            } else {
                if (lat == null || lon == null || alt == null)
                    throw new Error("lat/lon/alt required");
                await send_COMMAND_LONG("MAV_CMD_DO_SET_HOME", [
                    0,
                    0,
                    0,
                    0,
                    Number(lat),
                    Number(lon),
                    Number(alt),
                ]);
            }
        },
    );

    thing.setActionHandler(
        "setYaw",
        async ({ yaw, speed = 20, direction = 1, relative = false }) => {
            // CONDITION_YAW: p1=yaw, p2=speed, p3=dir, p4=relative(1/0)
            await send_COMMAND_LONG("MAV_CMD_CONDITION_YAW", [
                Number(yaw),
                Number(speed),
                Number(direction),
                relative ? 1 : 0,
                0,
                0,
                0,
            ]);
        },
    );

    thing.setActionHandler("simulateBattery", async (input) => {
        let payload = input;
        if (payload && typeof payload.value === "function") {
            payload = await payload.value();
        }
        if (payload == null || typeof payload !== "object") {
            payload = {};
        }
        const { active = true, ...rest } = payload;
        const normalized = { ...rest };
        if ("voltage" in normalized)
            normalized.voltage = Number(normalized.voltage);
        if ("current" in normalized)
            normalized.current = Number(normalized.current);
        if ("remaining" in normalized)
            normalized.remaining = Number(normalized.remaining);
        if ("temperature" in normalized)
            normalized.temperature = Number(normalized.temperature);
        if ("consumedMah" in normalized)
            normalized.consumedMah = Number(normalized.consumedMah);

        if (active === false || Object.keys(normalized).length === 0) {
            state.batteryOverride = null;
        } else {
            state.batteryOverride = {
                ...state.batteryOverride,
                ...normalized,
            };
        }
        const effective = state.batteryOverride || state.battery;
        await emitPropChange("battery", effective);
    });

    const emitPropChange = async (name, value) => {
        if (typeof thing.writeProperty === "function") {
            await thing.writeProperty(name, value);
        } else if (typeof thing.emitPropertyChange === "function") {
            await thing.emitPropertyChange(name, value);
        }
    };

    // live property updater (poll every 500ms)
    async function refresh() {
        try {
            const hb = await v1Last("HEARTBEAT");
            if (hb?.message) {
                const armed = !!(hb.message?.base_mode?.bits & 0x80);
                const modeCode = hb.message?.custom_mode ?? 0;
                const modeName =
                    Object.entries(MODES).find(
                        ([, v]) => v === modeCode,
                    )?.[0] || "UNKNOWN";
                state.armed = armed;
                state.mode = modeName;
                await emitPropChange("armed", armed);
                await emitPropChange("mode", modeName);
            }
            const gpi = await v1Last("GLOBAL_POSITION_INT");
            if (gpi?.message) {
                const pos = {
                    lat: gpi.message.lat / 1e7,
                    lon: gpi.message.lon / 1e7,
                    alt:
                        (gpi.message.relative_alt ?? gpi.message.alt ?? 0) /
                        1000,
                };
                state.position = pos;
                await emitPropChange("position", pos);
            }

            const vfr = await v1Last("VFR_HUD");
            if (vfr?.message) {
                state.groundspeed = vfr.message.groundspeed ?? 0;
                await emitPropChange("groundspeed", state.groundspeed);
            }

            const batteryStatus = await v1Last("BATTERY_STATUS");
            if (batteryStatus?.message) {
                const msg = batteryStatus.message;
                const voltages = Array.isArray(msg.voltages)
                    ? msg.voltages.filter(
                          (v) => typeof v === "number" && v > 0 && v < 65535,
                      )
                    : [];
                const voltage =
                    voltages.length > 0
                        ? voltages.reduce((a, b) => a + b, 0) /
                          voltages.length /
                          1000
                        : 0;
                const current =
                    typeof msg.current_battery === "number" &&
                    msg.current_battery >= 0
                        ? msg.current_battery / 100
                        : null;
                const remaining =
                    typeof msg.battery_remaining === "number" &&
                    msg.battery_remaining >= 0
                        ? msg.battery_remaining
                        : null;
                const temperature =
                    typeof msg.temperature === "number"
                        ? msg.temperature / 100
                        : null;
                const consumed =
                    typeof msg.current_consumed === "number"
                        ? msg.current_consumed / 1000
                        : null;
                state.battery = {
                    voltage,
                    current,
                    remaining,
                    temperature,
                    consumedMah: consumed,
                    status:
                        (msg.battery_function && msg.battery_function.type) ||
                        "NORMAL",
                };
                await emitPropChange(
                    "battery",
                    state.batteryOverride || state.battery,
                );
            }
        } catch (e) {
            log(
                "Error updating drone state:",
                e?.response?.status || e.message || e,
            );
        }
    }
    setInterval(refresh, 500);

    await thing.expose();
    log(`WoT Servient on :${WOT_PORT}; M2R=${M2R_BASE} (v1); TDD=${TDD_URL}`);

    // TD registration to Zion (PUT, fallback POST) + periodic refresh
    const THINGS_ENDPOINT = `${TDD_URL}/things`;

    async function upsertTD() {
        const td = await thing.getThingDescription();
        const id = encodeURIComponent(td.id || `urn:dev:ops:drone:${SYSID}`);

        if (!ZION_TOKEN && ZION_EMAIL && ZION_PASSWORD) {
            await getZionToken();
        }
        const baseHeaders = {
            "content-type": "application/td+json",
            ...authHeaders(),
        };

        try {
            const res = await axios.put(`${THINGS_ENDPOINT}/${id}`, td, {
                headers: baseHeaders,
                validateStatus: (s) => [200, 201, 202, 204].includes(s),
            });
            log(`TD upserted via PUT (${res.status})`);
            return;
        } catch (e) {
            if (e?.response?.status === 401 && ZION_EMAIL && ZION_PASSWORD) {
                await getZionToken();
                const res = await axios.put(`${THINGS_ENDPOINT}/${id}`, td, {
                    headers: { ...baseHeaders, ...authHeaders() },
                    validateStatus: (s) => [200, 201, 202, 204].includes(s),
                });
                log(`TD upserted via PUT after login (${res.status})`);
                return;
            }
            try {
                const res = await axios.post(`${THINGS_ENDPOINT}`, td, {
                    headers: baseHeaders,
                });
                log(
                    `TD registered via POST (${res.status}) location=${res.headers?.location || "n/a"}`,
                );
            } catch (e2) {
                const status = e2?.response?.status || e2.message;
                log(
                    `TD registration failed (${status}): ${JSON.stringify(e2?.response?.data || {})}`,
                );
                throw e2;
            }
        }
    }

    (async function registerLoop() {
        for (;;) {
            try {
                await upsertTD();
                break;
            } catch {
                await sleep(3000);
            }
        }
        setInterval(() => upsertTD().catch(() => {}), 5 * 60 * 1000);
    })();
})();
