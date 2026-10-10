# Device Fleet Monitor

A small HTTP service that tracks a fleet of devices via heartbeats and reports whether each device is `ONLINE` or `OFFLINE`, plus a simulator that drives a fleet of devices against it.
---

## 1. What this project does

- Devices **register** themselves with the service (`id`, `name`).
- Registered devices send periodic **heartbeats** (optionally carrying `cpu_usage`, `signal_strength`, `status`).
- The service exposes APIs to **list devices**, **fetch a single device**, and get a **fleet summary**.
- A device is `ONLINE` if its most recent heartbeat arrived within the last **30 seconds**, otherwise `OFFLINE`. The timeout is configurable.
- A **simulator** starts N virtual devices, lets you stop one mid-run, and prints a live view so the ONLINE → OFFLINE transition is easy to observe.

---

## 2. Design and architecture

### 2.1 Layered structure

```
HTTP layer        routes, request validation, error -> status code mapping
      |
Service layer     FleetService: register / heartbeat / list / get / summary
      |
Domain layer      Device type + pure status rules (no I/O, no framework)
      |
Repository layer  DeviceRepository interface -> InMemoryDeviceRepository
```

Each layer only knows about the one below it. The domain layer has zero dependencies on Express, on the clock, or on storage, which is what makes the status rules trivially testable.

### 2.2 The central decision: status is derived, never stored

A device record stores only facts:

```ts
{ id, name, registeredAt, lastHeartbeatAt, lastReportedTimestamp, lastMetrics }
// lastMetrics = { status?, cpuUsage?, signalStrength?, reportedAt }
```

`ONLINE` / `OFFLINE` is **computed at read time** from `now - lastHeartbeatAt`:

```ts
function deriveStatus(lastHeartbeatAt, now, timeoutMs) {
  if (lastHeartbeatAt === null) return "OFFLINE";
  return now - lastHeartbeatAt <= timeoutMs ? "ONLINE" : "OFFLINE";
}
```

The obvious alternative — a background `setInterval` sweeper that flips a stored `status` field every second — was considered and rejected:

- A stored status is correct only between sweeps; a read landing mid-interval returns stale data.
- It introduces write contention between the sweeper and heartbeat handlers for no benefit.
- Its cost grows with fleet size (sweep every device every tick) instead of with request volume.
- It is extra moving machinery to reason about, test and shut down cleanly.

Deriving on read is O(1) per device, always correct at the instant of the read, and needs no lifecycle management. The one thing it cannot do is fire an *event* when a device goes offline (there is no moment at which anything "happens"). That is noted under Known Limitations, with the fix I would use.

### 2.3 Clock injection

Nothing in this codebase calls `Date.now()` directly. A `Clock` interface is passed down from the composition root:

```ts
interface Clock { now(): number }   // SystemClock in prod, FakeClock in tests
```

This is why the 30-second timeout tests run in **milliseconds instead of 30+ seconds** and are not flaky: the test advances a fake clock rather than sleeping. It also means the timeout boundary can be tested at exact millisecond precision, which a sleep-based test cannot do reliably.

`SystemClock` reads the wall clock **once at startup** and measures everything after that with the monotonic clock (`performance.now()`). If NTP steps the wall clock backwards while the server runs, a plain `Date.now()` would make a fresh heartbeat look older than an earlier one and could flip a live device to `OFFLINE`. The monotonic clock cannot go backwards. The trade-off is that over a very long uptime the server's timestamps can drift slightly from true wall time; for a 30-second liveness window that is irrelevant.

### 2.4 Which timestamp defines liveness

The heartbeat body carries a device-reported `timestamp`, but device clocks drift and cannot be trusted for a liveness decision. So:

- **`lastHeartbeatAt` = server receive time.** This is what `ONLINE`/`OFFLINE` is computed from and what the API returns as `last_heartbeat`.
- **`lastReportedTimestamp` = the device's own claim.** Stored and returned alongside, useful for diagnosing clock skew, never used for status.
- If the two differ by more than `CLOCK_SKEW_WARN_MS`, a warning is logged with the device id. The heartbeat is still accepted — rejecting telemetry because a device's NTP is off would make the monitor less useful exactly when something is wrong.

### 2.5 Out-of-order and duplicate heartbeats

`lastHeartbeatAt` only ever moves forward (`max(existing, incoming)`). A delayed heartbeat arriving after a newer one cannot drag a device's liveness backwards. `lastReportedTimestamp` likewise keeps the newest time the device has claimed.

**Metrics** (`status`, `cpu_usage`, `signal_strength`) have their own ordering rule, because a delayed packet should still count for liveness (the device *was* alive) but must not overwrite a newer reading with an older one:

| Incoming heartbeat | Stored metrics |
| --- | --- |
| Carries no metric fields | Kept — it is a liveness ping |
| Device `timestamp` older than the stored reading's | Kept — the reading is stale |
| Device `timestamp` equal to or newer than the stored reading's | Replaced |
| No device `timestamp` | Replaced — it was received just now, so it is the newest reading we have |

A heartbeat that is accepted replaces the whole metrics snapshot: fields it does not carry become `null`, so one record never mixes readings taken at different times. Each stored reading keeps its own device timestamp (`lastMetrics.reportedAt`) for this comparison, separate from `lastReportedTimestamp`; otherwise a metric-less ping with a newer timestamp would block a delayed heartbeat whose readings are still newer than the stored ones.

Using the device clock here is deliberate and narrow: it only orders readings *from the same device*, where drift largely cancels out. It is never used for liveness.

### 2.6 Concurrency

Node's event loop runs each request handler to completion without preemption, and all repository mutations are synchronous, so there are no torn reads or lost updates within a single process. Updates go through `repo.update(id, change)`, a single read-modify-write call, so a storage backend can make the same step atomic. The concurrency tests fire 50 simultaneous heartbeats and 10 simultaneous registrations of one id (exactly one `201`, nine `409`). The real limitation is horizontal: two processes would each hold their own map. See Known Limitations.

The repository interface is synchronous on purpose. An async interface would only pay off for a database this exercise does not need, and would spread `await` through every layer for an in-memory map. The cost is noted in §11.

### 2.7 Project layout

```
device-fleet-monitor/
├── README.md
├── CLAUDE.md                     # working notes / conventions for AI-assisted edits
├── package.json
├── tsconfig.json                 # typechecks src, tests and simulator
├── tsconfig.build.json           # emits only src/ to dist/
├── vitest.config.ts
├── .env.example
├── .gitignore
├── Dockerfile
├── .dockerignore
├── src/
│   ├── index.ts                  # entrypoint: config -> wiring -> listen -> graceful shutdown
│   ├── app.ts                    # buildApp({ clock, repo, config }) -> Express app (no listen)
│   ├── config.ts                 # env parsing + defaults
│   ├── domain/
│   │   ├── device.ts             # Device type, deriveStatus, applyHeartbeat, toDeviceView
│   │   └── errors.ts             # DeviceNotFoundError, DuplicateDeviceError, ValidationError
│   ├── repository/
│   │   ├── device-repository.ts  # interface
│   │   └── in-memory-device-repository.ts
│   ├── services/
│   │   └── fleet-service.ts      # register, recordHeartbeat, list, get, summary
│   ├── http/
│   │   ├── routes.ts
│   │   ├── schemas.ts            # zod request schemas
│   │   └── error-handler.ts      # domain error -> HTTP status, uniform error body
│   ├── lib/
│   │   ├── clock.ts              # Clock, SystemClock, FakeClock
│   │   └── logger.ts             # pino, request-id child logger
│   └── public/
│       └── index.html            # single-file operator UI served at /, no build step
├── simulator/
│   └── simulate.ts               # N devices, configurable interval, --stop to kill one
└── tests/
    ├── unit/
    │   ├── clock.test.ts
    │   ├── config.test.ts
    │   ├── device-status.test.ts
    │   ├── apply-heartbeat.test.ts
    │   └── fleet-service.test.ts
    └── integration/
        ├── test-app.ts           # buildApp() with a FakeClock and a silent logger
        ├── devices.api.test.ts
        ├── timeout.test.ts
        └── concurrency.test.ts
```

`app.ts` builds the Express app but does not listen, so integration tests can mount it with a `FakeClock` and drive real HTTP requests through supertest without opening a port or waiting on wall-clock time.

---

## 3. Prerequisites

- **Node.js 20.12 or later** (`node --version`); developed on Node 22
- **npm 10 or later**
- Optional: **Docker** 24+ if you prefer to run it containerised
- No database, no external services, nothing to provision

---

## 4. Build

```bash
git clone <repository-url>
cd device-fleet-monitor
npm install
npm run build        # typecheck + emit to dist/
```

`npm run build` must pass with zero TypeScript errors; `strict` is on.

---

## 5. Run the application

Development (hot reload, pretty logs):

```bash
npm run dev
```

Production-style:

```bash
npm run build
npm start
```

The server listens on **http://localhost:3000** by default and logs a startup line with the active configuration.

Open **http://localhost:3000/** in a browser for the operator UI: fleet summary counts, every device with its derived status, last heartbeat, device-reported time and latest metrics, an ONLINE/OFFLINE filter, and a form to register a device. It refreshes every 2 seconds and uses only the public API.

### Configuration

All settings come from environment variables, with working defaults. Copy `.env.example` to `.env` to override; it is loaded automatically at startup if present.

An invalid value (for example `HEARTBEAT_TIMEOUT_MS=abc`, `0` or `-5`) makes the server **refuse to start** with a message naming the variable, rather than silently falling back to a default. A monitor running with a timeout nobody chose is worse than one that does not start.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HEARTBEAT_TIMEOUT_MS` | `30000` | Window within which a heartbeat keeps a device `ONLINE` |
| `CLOCK_SKEW_WARN_MS` | `60000` | Log a warning if device-reported time drifts beyond this |
| `LOG_LEVEL` | `info` | pino level: `trace`…`error` |

Setting `HEARTBEAT_TIMEOUT_MS=5000` is the quickest way to watch the offline transition during a demo.

### Docker

```bash
docker build -t device-fleet-monitor .
docker run -p 3000:3000 -e HEARTBEAT_TIMEOUT_MS=30000 device-fleet-monitor
```

`Ctrl+C` / `SIGTERM` shuts down gracefully: the server stops accepting connections, finishes in-flight requests, and exits (forcibly after 10 seconds if a keep-alive connection holds it open).

---

## 6. Run the simulator

With the server already running, in a second terminal:

```bash
npm run simulate
```

Defaults: **5 devices**, heartbeat every **5 seconds**, registering themselves on startup.

Options:

```bash
npm run simulate -- --devices 8 --interval 3000 --url http://localhost:3000
npm run simulate -- --stop device-03 --stop-after 20000
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--devices` | `5` | Number of simulated devices |
| `--interval` | `5000` | Milliseconds between heartbeats |
| `--stop` | – | Device id to silence mid-run (repeatable) |
| `--stop-after` | `20000` | Milliseconds before silencing it |
| `--url` | `http://localhost:3000` | Target server |

The simulator registers devices idempotently (a `409` on restart is treated as "already known"), sends plausible `cpu_usage` and `signal_strength` values, and prints a table refreshed every second:

```
DEVICE        SIM         SENT   LAST SEEN  SERVER
device-01     running        7      0s ago  ONLINE
device-03     STOPPED        2     35s ago  OFFLINE
```

`SIM` is what the simulator is doing; `SERVER` is the status read back from `GET /devices`, so the table shows the server's derived status, not the simulator's opinion. Invalid flags or an unknown `--stop` id fail immediately with a message. `Ctrl+C` stops it cleanly.

### Verifying the timeout by hand

```bash
npm run simulate -- --stop device-03 --stop-after 10000
# wait ~40 seconds, then:
curl -s localhost:3000/devices | jq '.[] | {id, status}'
curl -s localhost:3000/summary
```

`device-03` reports `OFFLINE` while the rest stay `ONLINE`, and `summary` shows `online: 4, offline: 1`.

---

## 7. Run the tests

```bash
npm test                 # full suite, single run
npm run test:watch       # watch mode
npm run test:coverage    # coverage report
```

The entire suite completes in a couple of seconds — no test sleeps on real time.

### What is covered

**Unit — status rules (`device-status.test.ts`)**
- Heartbeat 0 ms ago → `ONLINE`
- Heartbeat 29,999 ms ago → `ONLINE`
- Heartbeat at exactly 30,000 ms → `ONLINE` (boundary is inclusive; see Assumptions)
- Heartbeat 30,001 ms ago → `OFFLINE`
- Registered but never heard from → `OFFLINE`
- Respects a non-default `HEARTBEAT_TIMEOUT_MS`

**Unit — heartbeat rules (`apply-heartbeat.test.ts`)**
- `lastHeartbeatAt` is server receive time, ignores the device timestamp, and never moves backwards
- Metrics: an older device timestamp keeps the stored reading but still updates liveness; equal or newer replaces it; a missing timestamp replaces it
- A delayed reading older than one replaced by an untimed heartbeat is still rejected
- A delayed reading is accepted after a newer *metric-less* ping, if it is newer than the stored reading
- A partial heartbeat replaces the whole snapshot; an empty one is a liveness ping that keeps the stored metrics
- Applying a heartbeat does not mutate its input

**Unit — clock (`clock.test.ts`)**
- `SystemClock` is unaffected by the wall clock stepping backwards after startup, and never returns a smaller value than its previous reading

**Unit — config (`config.test.ts`)**
- Defaults when nothing is set; overrides are read
- `HEARTBEAT_TIMEOUT_MS` of `abc`, `0`, `-5`, `1.5` and an unknown `LOG_LEVEL` are rejected, naming the variable

**Unit — service (`fleet-service.test.ts`)**
- Registering a device returns it as `OFFLINE` with `last_heartbeat: null`
- Registering a duplicate id raises `DuplicateDeviceError`
- A heartbeat from an unregistered id raises `DeviceNotFoundError`
- Clock skew beyond `CLOCK_SKEW_WARN_MS` logs a warning but the heartbeat is accepted; exactly at the threshold does not warn
- Status is derived per device at read time; list filtering; summary counts across a mixed and an empty fleet, with `total === online + offline`

**Integration — HTTP (`devices.api.test.ts`)**
- `POST /devices` → `201` with the created record; duplicate → `409`
- `POST /devices` with a missing, empty, unsafe or 65-character `id`, a blank `name`, an unknown field, malformed JSON or no body → `400` naming the field
- `POST /devices/:id/heartbeat` → `200`, device becomes `ONLINE`; an empty body is accepted as a liveness ping
- Heartbeat for unknown id → `404` with the exact error body
- Heartbeat with a malformed `timestamp`, lowercase `status`, `cpu_usage` of -1 or 101, `signal_strength` of -151 or 1, a string number, or a misspelt field (`cpu_usge`) → `400`
- `cpu_usage` 0 and 100, `signal_strength` -150 and 0 are accepted (inclusive bounds); a timestamp with a UTC offset is normalised
- `GET /devices`, `GET /devices?status=OFFLINE`, invalid filter → `400`; `GET /devices/:id` full detail or `404`
- `/healthz`, and an unknown route returns the uniform error shape

**Integration — timeout behaviour (`timeout.test.ts`)**
- Exactly at 30 s → still `ONLINE`; 1 ms later → `OFFLINE` with no further requests
- A fresh heartbeat after going offline brings it back to `ONLINE`
- `/summary` and `?status=OFFLINE` track the transition
- Heartbeats arriving every 30 s keep a device `ONLINE` indefinitely

**Integration — concurrency (`concurrency.test.ts`)**
- 50 parallel heartbeats across 5 devices leave every device `ONLINE` with a consistent `lastHeartbeatAt`
- 10 parallel registrations of the same id produce exactly one `201` and nine `409`

---

## 8. Example API requests

Base URL: `http://localhost:3000`

### Register a device

```bash
curl -X POST localhost:3000/devices \
  -H 'Content-Type: application/json' \
  -d '{"id":"device-01","name":"Lab Device 01"}'
```

```json
{
  "id": "device-01",
  "name": "Lab Device 01",
  "status": "OFFLINE",
  "last_heartbeat": null,
  "registered_at": "2026-10-10T07:00:00.000Z",
  "last_reported_timestamp": null,
  "metrics": null
}
```
`201 Created`. A repeat of the same id returns `409`. `id` must be 1–64 characters of `[A-Za-z0-9._-]`; `name` must be non-blank (max 100). Unknown fields are rejected.

### Send a heartbeat

```bash
curl -X POST localhost:3000/devices/device-01/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"timestamp":"2026-10-10T07:00:05.000Z","status":"OK","cpu_usage":42,"signal_strength":-71}'
```

```json
{
  "id": "device-01",
  "name": "Lab Device 01",
  "status": "ONLINE",
  "last_heartbeat": "2026-10-10T07:00:05.012Z",
  "registered_at": "2026-10-10T07:00:00.000Z",
  "last_reported_timestamp": "2026-10-10T07:00:05.000Z",
  "metrics": { "status": "OK", "cpu_usage": 42, "signal_strength": -71 }
}
```
`200 OK`. Every body field is optional, and an empty body (or none) is a valid liveness ping. When present, fields must be well-formed:

| Field | Rule |
| --- | --- |
| `timestamp` | ISO 8601 date-time, `Z` or a UTC offset |
| `status` | `OK`, `WARN` or `ERROR` (case-sensitive) |
| `cpu_usage` | number, 0–100 inclusive |
| `signal_strength` | number, -150–0 dBm inclusive |

Any other field is rejected with `400`, so a typo such as `cpu_usge` fails loudly instead of being silently dropped. See §2.5 for when stored metrics are replaced.

### List devices

```bash
curl localhost:3000/devices
curl 'localhost:3000/devices?status=OFFLINE'
```

```json
[
  {
    "id": "device-01",
    "name": "Lab Device 01",
    "status": "ONLINE",
    "last_heartbeat": "2026-10-10T07:00:05.012Z"
  }
]
```

### Get one device

```bash
curl localhost:3000/devices/device-01
```
`200` with the full record including metrics, or `404`.

### Fleet summary

```bash
curl localhost:3000/summary
```

```json
{ "total": 5, "online": 4, "offline": 1 }
```

### Health check

```bash
curl localhost:3000/healthz
```

```json
{ "status": "ok", "uptime_seconds": 124 }
```

### Error format

Every error shares one shape, so clients never have to branch on the endpoint:

```json
{
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "No device registered with id 'device-99'"
  }
}
```

Validation errors add the offending `field` when there is one:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "cpu_usage: Too big: expected number to be <=100", "field": "cpu_usage" } }
```

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body or query failed schema validation, or the body is not valid JSON |
| `DEVICE_NOT_FOUND` | 404 | Unknown device id |
| `NOT_FOUND` | 404 | Unknown route |
| `DEVICE_ALREADY_EXISTS` | 409 | Re-registering an existing id |
| `PAYLOAD_TOO_LARGE` | 413 | Request body over 10 kB |
| `INTERNAL_ERROR` | 500 | Anything unhandled; details go to the log, not the response |

---

## 9. Assumptions

1. **The 30-second boundary is inclusive.** A heartbeat exactly 30,000 ms old is `ONLINE`; 30,001 ms is `OFFLINE`. The spec says "within the last 30 seconds", which I read as inclusive. There is an explicit test pinning this so the intent is visible rather than accidental.
2. **A registered device with no heartbeat yet is `OFFLINE`.** A third `UNKNOWN` state would be more descriptive, but the required `/summary` shape is `total / online / offline`, so a third state would not add up. Two states keeps `total === online + offline` true by construction.
3. **Heartbeats from unregistered devices are rejected with `404`,** not auto-registered. Silently creating devices from telemetry would let a typo'd id inflate the fleet, and fleet membership should be a deliberate act.
4. **Server receive time is authoritative for liveness.** The device-reported `timestamp` is recorded but never used for the status decision (reasoning in §2.4).
5. **Device ids are opaque strings,** constrained to 1–64 characters of `[A-Za-z0-9._-]` to keep them safe in URLs.
6. **In-memory storage is acceptable for this exercise.** The spec does not require durability, and persistence is listed as optional. Storage sits behind an interface, so the service never depends on the map directly.
7. **No authentication.** Out of scope for the exercise; noted as a limitation rather than silently ignored.
8. **Single process.** No clustering or multiple replicas.
9. **The device timestamp may order a device's own readings.** It is never used for liveness, but it decides whether a delayed heartbeat's metrics are newer than the stored ones (§2.5). A heartbeat without a timestamp is treated as the newest reading, because it was just received.
10. **Device `status` is a fixed set: `OK`, `WARN`, `ERROR`.** A free string would accept any firmware's vocabulary, but then nothing reading the API could rely on the values meaning anything. Adding a state is a deliberate API change.
11. **Metric ranges:** `cpu_usage` is a percentage (0–100) and `signal_strength` is RSSI in dBm (-150–0). Out-of-range readings are rejected rather than stored, so nonsense never reaches an operator.
12. **A heartbeat's metrics are one snapshot.** A heartbeat carrying only some metrics replaces all of them (the rest become `null`); one carrying none is a pure liveness ping and leaves stored metrics alone.

---

## 10. Known limitations

- **Data is lost on restart.** Everything lives in a process-local map.
- **Does not scale horizontally.** Two instances behind a load balancer would each see a different fleet, because the map is not shared.
- **No offline events.** Because status is derived rather than stored, nothing "fires" when a device crosses the 30-second line. Polling sees the change immediately; a webhook or alert consumer would not. A monitoring product needs this.
- **No heartbeat history.** Only the latest heartbeat is kept, so there is no uptime percentage, no metric trend, no "when did this last flap".
- **`GET /devices` is unpaginated.** Fine at tens of devices, not at tens of thousands.
- **A strict schema is brittle across firmware versions.** Unknown fields are rejected, so a device that starts sending a new field breaks until the server learns it.
- **The UI makes one request per device per refresh** (it reads `/devices/:id` for metrics). Fine for a lab fleet; a larger fleet would want a list endpoint that includes metrics.
- **The Dockerfile was not verified on the development machine** (no Docker daemon was available); the Node commands above are the verified path.
- **No authentication, authorization, or rate limiting.** Any caller can register devices or spoof heartbeats for an id they do not own.
- **No TLS**; expected to sit behind a terminating proxy.

---

## 11. What I would improve with one more day

In the order I would actually do it:

1. **Persistence behind the existing repository interface** — SQLite or Postgres. The service already depends only on `DeviceRepository`, and every write goes through one read-modify-write call (`update(id, change)`) that maps onto a transaction. The interface is synchronous today because an in-memory map needs nothing else; a real database driver is async, so this step also makes the interface return Promises and adds `await` in the service. That is a mechanical change, deliberately deferred until there is a database to justify it.
2. **Offline transition events.** Add a lightweight checker that compares derived status against a `lastNotifiedStatus` field and emits a transition event, keeping reads derived (correct) while gaining edge-triggered alerts. This is the right place to add a webhook or SSE stream for a live dashboard.
3. **Heartbeat history and metrics.** Append heartbeats to a time-series table with retention, enabling uptime percentage, CPU trends and flap detection — the questions an operator actually asks.
4. **Authentication.** A per-device key or HMAC-signed heartbeat so a device id cannot be spoofed, plus an operator token on the read APIs.
5. **A `/metrics` endpoint in Prometheus format** (fleet size, online count, heartbeats/sec, request latency) so the monitor is itself monitorable.
6. **OpenAPI spec generated from the existing zod schemas,** with contract tests asserting the implementation matches it.
7. **Pagination, cursor-based, on `GET /devices`,** plus filtering by name and last-seen window.
8. **CI pipeline** running typecheck, lint, tests and a Docker build on every push.
9. **A load test** (k6) at a few thousand heartbeats per second, to find where the single-process design stops being adequate and quantify the point at which step 1 and 2 become mandatory.

---

## 12. AI Usage

> Edit this section to match exactly what you did before submitting — it should be your account, not a template.

**Tools used**
- **Claude (chat)** — design reasoning before any code existed: derive status vs sweep it, how to make a 30-second rule testable without a 30-second test, which edge cases were worth pinning.
- **Claude Code** — implementation of the parts where the decision was already made: Express wiring, config parsing, zod schemas, Dockerfile, simulator CLI, first pass of the test suite.

**What I used them for**
- High-volume, low-judgement code — boilerplate, argument parsing, container setup. This is where assistants are strictly faster than me and nothing is at stake.
- Turning my own list of edge cases into concrete test cases, once I had decided what the edges were.
- A first draft of documentation structure, rewritten wherever it did not match my actual reasoning.

**What I deliberately did not delegate**
- The architecture decisions in §2. Those are the parts of this submission with any judgement in them, and an assistant optimises for the common pattern rather than the correct one.
- The choice of what to test. I wrote the edge-case list by hand and then asked for the tests, rather than asking for "tests for this file" — tests generated from an implementation assert whatever that implementation does, bugs included.
- Commit messages, so the history reflects what I was actually thinking at each step.

**Code I changed or rejected**

The first implementation suggested for the timeout was a `setInterval` sweeper that iterated every device each second and mutated a stored `status` field. I rejected it: a stored status is only correct between sweeps, it creates write contention with the heartbeat path for no gain, and it adds a background lifecycle to manage and shut down. I replaced it with a pure `deriveStatus(lastHeartbeatAt, now, timeoutMs)` computed at read time — always correct at the instant of the read, O(1) per device, nothing to tear down.

Relatedly, the generated timeout test used `await new Promise(r => setTimeout(r, 31000))`, which made the suite take over 30 seconds and still be timing-dependent. I introduced a `Clock` interface with a `FakeClock` for tests, so the same behaviour is verified by advancing a counter — the suite now runs in about a second and tests the boundary at exact millisecond precision.

A third suggestion I corrected rather than rejected: the initial heartbeat handler computed liveness from the device-reported `timestamp` in the request body. That is a real defect — a device with a drifting clock would read as permanently offline or permanently online. I separated the two timestamps as described in §2.4.

**How I kept the generated code consistent**
- A `CLAUDE.md` at the repo root states the working agreement — layer boundaries, "never call `Date.now()` directly, take a `Clock`", the uniform error-code shape, no comments that restate the line below them. Without it, suggestions drift away from the architecture a few files in.
- I reviewed generated code before committing it rather than after, and removed the usual residue: narration comments, comments repeating the code, defensive `try/catch` around things that cannot throw, and unused abstractions introduced "for flexibility".
- Anything I could not explain out loud did not get committed. That rule cut two or three plausible-looking suggestions that I did not fully understand.

**What I verified myself**
- I ran the simulator, stopped `device-03` mid-run, and watched with `curl` as it flipped to `OFFLINE` after the timeout and back to `ONLINE` when heartbeats resumed — confirming the derived-status logic behaves correctly against a real clock and not only against the fake one in tests.
- I cloned the repository into a clean directory and followed this README end to end to confirm the documented commands actually work from scratch.
- I hand-checked the boundary case (exactly 30,000 ms) against the test, because an off-by-one on an inclusive-vs-exclusive comparison is exactly the kind of thing that passes review and fails in production.

---

## 13. Quick start (TL;DR)

```bash
npm install
npm test                 # all green in ~2s
npm run dev              # terminal 1
npm run simulate -- --stop device-03 --stop-after 15000   # terminal 2
curl -s localhost:3000/summary
# wait ~30s
curl -s localhost:3000/summary   # one device has moved to offline
```
