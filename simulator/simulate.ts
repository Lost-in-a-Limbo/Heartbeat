import { parseArgs } from "node:util";
import { SystemClock } from "../src/lib/clock.js";

interface Options {
  devices: number;
  intervalMs: number;
  stop: string[];
  stopAfterMs: number;
  url: string;
}

interface SimDevice {
  id: string;
  timer: NodeJS.Timeout | undefined;
  sent: number;
  lastError: string | undefined;
}

interface DeviceRow {
  id: string;
  status: string;
  last_heartbeat: string | null;
}

const clock = new SystemClock();

function readOptions(): Options {
  const { values } = parseArgs({
    options: {
      devices: { type: "string", default: "5" },
      interval: { type: "string", default: "5000" },
      stop: { type: "string", multiple: true, default: [] },
      "stop-after": { type: "string", default: "20000" },
      url: { type: "string", default: "http://localhost:3000" },
    },
  });
  return {
    devices: positiveInt("--devices", values.devices),
    intervalMs: positiveInt("--interval", values.interval),
    stop: values.stop,
    stopAfterMs: positiveInt("--stop-after", values["stop-after"]),
    url: values.url.replace(/\/$/, ""),
  };
}

function positiveInt(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${flag} must be a positive integer, got '${raw}'`);
    process.exit(1);
  }
  return value;
}

function deviceId(index: number): string {
  return `device-${String(index + 1).padStart(2, "0")}`;
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function register(options: Options, id: string): Promise<void> {
  const res = await post(`${options.url}/devices`, { id, name: `Simulated ${id}` });
  // 409 means a previous run already registered it; that is fine.
  if (!res.ok && res.status !== 409) {
    throw new Error(`registering ${id} failed with HTTP ${res.status}: ${await res.text()}`);
  }
}

async function sendHeartbeat(options: Options, device: SimDevice): Promise<void> {
  const cpu = randomBetween(5, 95);
  try {
    const res = await post(`${options.url}/devices/${device.id}/heartbeat`, {
      timestamp: new Date(clock.now()).toISOString(),
      status: cpu > 85 ? "WARN" : "OK",
      cpu_usage: cpu,
      signal_strength: randomBetween(-100, -40),
    });
    device.lastError = res.ok ? undefined : `HTTP ${res.status}`;
    if (res.ok) device.sent += 1;
  } catch (error) {
    device.lastError = error instanceof Error ? error.message : String(error);
  }
}

async function render(options: Options, devices: SimDevice[]): Promise<void> {
  let server: DeviceRow[] = [];
  let serverError = "";
  try {
    server = (await (await fetch(`${options.url}/devices`)).json()) as DeviceRow[];
  } catch (error) {
    serverError = `cannot reach ${options.url}: ${error instanceof Error ? error.message : error}`;
  }
  const byId = new Map(server.map((row) => [row.id, row]));
  const now = clock.now();

  const lines = devices.map((device) => {
    const row = byId.get(device.id);
    const age = row?.last_heartbeat ? `${Math.round((now - Date.parse(row.last_heartbeat)) / 1000)}s ago` : "never";
    const sim = device.timer === undefined ? "STOPPED" : "running";
    return [
      device.id.padEnd(12),
      sim.padEnd(9),
      String(device.sent).padStart(5),
      age.padStart(10),
      (row?.status ?? "?").padEnd(8),
      device.lastError ?? "",
    ].join("  ");
  });

  console.clear();
  console.log(`Simulating ${devices.length} devices against ${options.url}, heartbeat every ${options.intervalMs} ms. Ctrl+C to stop.\n`);
  console.log(["DEVICE".padEnd(12), "SIM".padEnd(9), " SENT", "LAST SEEN".padStart(10), "SERVER"].join("  "));
  console.log(lines.join("\n"));
  if (serverError) console.log(`\n${serverError}`);
}

async function main(): Promise<void> {
  const options = readOptions();
  const devices: SimDevice[] = Array.from({ length: options.devices }, (_, i) => ({
    id: deviceId(i),
    timer: undefined,
    sent: 0,
    lastError: undefined,
  }));

  const unknown = options.stop.filter((id) => !devices.some((device) => device.id === id));
  if (unknown.length > 0) {
    console.error(`--stop refers to unknown device(s): ${unknown.join(", ")}`);
    process.exit(1);
  }

  for (const device of devices) await register(options, device.id);

  for (const device of devices) {
    void sendHeartbeat(options, device);
    device.timer = setInterval(() => void sendHeartbeat(options, device), options.intervalMs);
  }

  const stopTimer = setTimeout(() => {
    for (const device of devices.filter((d) => options.stop.includes(d.id))) {
      clearInterval(device.timer);
      device.timer = undefined;
    }
  }, options.stopAfterMs);

  const renderTimer = setInterval(() => void render(options, devices), 1000);

  process.on("SIGINT", () => {
    for (const device of devices) clearInterval(device.timer);
    clearTimeout(stopTimer);
    clearInterval(renderTimer);
    console.log("\nSimulator stopped.");
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("Is the server running? Start it with `npm run dev`.");
  process.exit(1);
});
