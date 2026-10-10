# User Guide — Using the Dashboard

This guide shows how to use the Device Fleet Monitor from the browser, and where each requirement of the problem statement can be seen working in the UI. For design, setup details and the API, see [README.md](README.md).

---

## 1. Start it (2 minutes)

You need Node.js 20.12 or later. The project was built and tested on Linux and is designed to run on macOS and Windows too (on Windows, use Git Bash or WSL for the terminal commands below, or see [README §3, Platform notes](README.md#platform-notes)). From the repository root:

```bash
npm install
npm run dev                 # terminal 1: the server, on http://localhost:3000
npm run simulate            # terminal 2: five simulated devices
```

Open **http://localhost:3000** in a browser. Within a few seconds five devices appear, all **online**.

> Tip: to see the offline transition sooner, start the server with `HEARTBEAT_TIMEOUT_MS=10000 npm run dev` (10 seconds instead of 30).

---

## 2. What is on the screen

```
Device Fleet Monitor   Updated 15:23:48                    <- header: time of the last refresh

5 devices · 4 online · 1 offline                            <- fleet summary

All   Online   Offline              [device-06] [Name] [Register]
───                                                          <- filters            <- register form

DEVICE     NAME        STATUS     LAST HEARTBEAT  DEVICE CLOCK  REPORTED  CPU %  SIGNAL DBM  REGISTERED
device-01  Simulated…  ● online   2s ago          15:23:47      ok        36     -56         15:15:47
device-03  Simulated…  ● offline  7m 57s ago      15:15:52      ok        59     -77         15:15:47
```

The page refreshes itself **every 2 seconds**. You never need to reload it.

| Part of the screen | What it shows | Where it comes from |
| --- | --- | --- |
| **Updated hh:mm:ss** | When the page last refreshed. Shows *Cannot reach server* if the server is down | Browser |
| **Summary line** | Total devices, how many are online (green), how many offline (clay) | `GET /summary` |
| **All / Online / Offline** | Filters the table by status. The active filter is underlined in green | `GET /devices?status=…` |
| **Register form** | Adds a new device to the fleet | `POST /devices` |
| **Device** | The device id | `GET /devices/{id}` |
| **Name** | The name given at registration | `GET /devices/{id}` |
| **Status** | `online` (green dot) or `offline` (clay dot), **worked out by the server at the moment of each refresh** | `GET /devices/{id}` |
| **Last heartbeat** | How long ago the server *received* the latest heartbeat. Hover for the exact time | Server clock |
| **Device clock** | The time the device *claimed* in its heartbeat. Shown for diagnosis only; never used to decide status | Device |
| **Reported** | The device's own health: `ok`, `warn` or `error` (error in clay) | Device |
| **CPU %**, **Signal dBm** | Latest readings from the device. `—` if it has not sent any | Device |
| **Registered** | When the device was registered. Hover for the exact time | Server clock |

---

## 3. Where each requirement is visible in the UI

| Requirement in the problem statement | Where to see it | How to check it |
| --- | --- | --- |
| **1. Register a device** | Register form | Walkthrough A |
| **2. Receive a heartbeat** | *Last heartbeat* resets to `0s ago`, metrics update | Walkthrough B |
| **3. List devices with their status** | The table | Shown on load; every registered device has a row |
| **4. Get device details** | Every row is the device's full detail record (`GET /devices/{id}`): status, both timestamps, all metrics, registration time | Hover a time to see its exact ISO value |
| **5. Fleet summary** | Summary line: *N devices · N online · N offline* | Always equals the table under **All** |
| **Device timeout (30 s)** | *Status* column and summary line | Walkthrough C |
| **Simulator; stop one device and watch it go OFFLINE** | Status of the stopped device | Walkthrough C |
| *Optional:* filtering by status | **All / Online / Offline** | Walkthrough D |
| *Optional:* additional device metrics | *Reported*, *CPU %*, *Signal dBm* columns | Walkthrough B |
| *Optional:* input validation and error handling | Message under the register form | Walkthrough E |
| *Optional:* simple UI | This page | — |
| *Optional:* persistent storage | Devices still listed after a server restart | Walkthrough F |

The UI shows the fleet and registers devices. It does **not** send heartbeats — heartbeats come from devices, which here means the simulator or a `curl` command. That keeps the operator's view separate from the devices it monitors.

---

## 4. Walkthroughs

### A. Register a device

1. Type an id in the first box, e.g. `device-06` (letters, digits, `.`, `_`, `-`; up to 64 characters).
2. Type a name, e.g. `Bench Unit`, and click **Register**.
3. A green message confirms it, and a new row appears showing **offline** with *Last heartbeat* `never`.
   A registered device is offline until it sends its first heartbeat.

### B. Send heartbeats and watch them arrive

The simulator is already sending a heartbeat from each device every 5 seconds: watch *Last heartbeat* count up to about `5s ago` and drop back to `0s ago`, and the CPU and signal values change.

To act as the device you registered in A, run this in a terminal:

```bash
curl -X POST localhost:3000/devices/device-06/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"status":"OK","cpu_usage":42,"signal_strength":-71}'
```

Within 2 seconds `device-06` turns **online** and shows CPU `42`, signal `-71`. Send different values and they appear exactly as sent.

### C. Watch a device go offline after the timeout, and come back

1. Stop the running simulator (`Ctrl+C`) and restart it so that one device goes silent:
   ```bash
   npm run simulate -- --stop device-03 --stop-after 15000
   ```
2. After 15 seconds `device-03` stops sending. Watch its *Last heartbeat* keep counting up while it stays **online**.
3. Once it passes **30 seconds** the dot turns clay and the word changes to **offline**, and the summary line moves one device from online to offline. Nothing was sent to make this happen: status is recalculated on every read from the age of the last heartbeat.
4. Run the `curl` from B against `device-03` (replace `device-06`), or restart the simulator without `--stop`: it turns **online** again immediately.

### D. Filter by status

Click **Offline**: only offline devices are listed. Click **Online**, then **All**. The summary line always shows the whole fleet, whatever the filter.

### E. See validation and error handling

In the register form:

- Register an id that already exists → red message: *A device with id '…' is already registered*.
- Leave the name blank, or type an id with a space or `/` → the browser refuses to submit.

The server checks everything again on its own, whoever calls it. From a terminal, each of these is rejected with a message naming the problem field (the full list of error cases, with the exact status code each returns, is in [README §8, "Try the error handling yourself"](README.md#try-the-error-handling-yourself)):

```bash
curl -X POST localhost:3000/devices/device-01/heartbeat -H 'Content-Type: application/json' -d '{"cpu_usage":101}'
curl -X POST localhost:3000/devices/device-01/heartbeat -H 'Content-Type: application/json' -d '{"status":"ok"}'
curl -X POST localhost:3000/devices/device-01/heartbeat -H 'Content-Type: application/json' -d '{"cpu_usge":5}'
curl -X POST localhost:3000/devices/ghost/heartbeat
```

### F. Keep the fleet across restarts (optional)

1. Stop the server and start it with a data file:
   ```bash
   DATA_FILE=./data/fleet.json npm run dev
   ```
2. Register a device or run the simulator, then stop the server (`Ctrl+C`) and start it again with the same command.
3. Reload the page: the devices are still listed. Any device whose last heartbeat is now older than 30 seconds shows **offline**, because status is never saved, only recalculated.

Without `DATA_FILE`, a restart starts with an empty fleet.

---

## 5. Where do the numbers come from?

- **Simulated devices** (`device-01` …) send random but realistic readings, because they have no real hardware: CPU 5–95 %, signal −100 to −40 dBm, `ok` (or `warn` when CPU is above 85). See `simulator/simulate.ts`.
- **The server stores exactly what a device sends** and only decides online/offline. It never generates readings. Proof: send your own values with the `curl` in B and they appear unchanged.

---

## 6. Troubleshooting

| You see | Do this |
| --- | --- |
| *Cannot reach server* in the header | The server is not running. Start it with `npm run dev` |
| *No devices registered yet* | Start the simulator (`npm run simulate`) or register one with the form |
| Simulator says *Is the server running?* | Start the server first, then the simulator |
| Server exits with *Invalid HEARTBEAT_TIMEOUT_MS* (or another variable) | Fix that environment variable; the server refuses to start with an invalid setting on purpose |
| `EADDRINUSE` when starting the server | Something already uses port 3000. Stop it, or start with `PORT=3001 npm run dev` and open `http://localhost:3001` |
| Everything went offline at once | The simulator was stopped. Start it again |
