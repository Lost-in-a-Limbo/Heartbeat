    # CLAUDE.md — working agreement for this repository

Conventions for AI-assisted edits in this project. Read this before generating or modifying code.

Project context is in `README.md` §2 (design and architecture). Do not contradict it; if a change seems to require contradicting it, say so instead of working around it.

---

## Commands

```bash
npm run dev            # dev server, hot reload
npm run build          # typecheck + emit to dist/
npm start              # run built output
npm test               # full suite, single run
npm run test:watch
npm run simulate       # device simulator against localhost:3000
```

The full test suite must finish in a few seconds. If a change makes it slower, that is a bug in the change.

---

## Hard rules

- **Never call `Date.now()` or `new Date()` for current time.** Take a `Clock` from `src/lib/clock.ts`. This is what keeps timeout behaviour testable without sleeping.
- **Never store a device's `ONLINE`/`OFFLINE` status.** It is derived at read time by `deriveStatus()`. Do not add a background sweeper, cron, or `setInterval` that mutates status. (Reasoning: README §2.2.)
- **`lastHeartbeatAt` is server receive time.** The device-reported `timestamp` is stored as `lastReportedTimestamp` and never used for a liveness decision.
- **`lastHeartbeatAt` only moves forward.** Out-of-order heartbeats must not drag it backwards.
- **No test may sleep on real time.** Advance a `FakeClock` instead.
- **Do not add dependencies** without flagging it first. Current set: express, zod, pino (+ pino-pretty, tsx, typescript, vitest, @vitest/coverage-v8, supertest, and the `@types/*` packages for node, express and supertest in dev).

---

## Layering

```
http  ->  services  ->  domain
                    ->  repository (interface)
```

- `domain/` is pure: no Express, no clock reads, no I/O, no imports from layers above it.
- `services/` holds the use cases. It receives `Clock`, `DeviceRepository` and config by constructor injection — it never imports a concrete implementation.
- `http/` does validation, calls one service method, maps domain errors to status codes. No business logic in route handlers.
- `repository/` is an interface plus implementations. Services depend on the interface only, so storage can be swapped.
- `app.ts` builds the Express app and does **not** call `listen()`. Only `index.ts` listens. Tests mount `buildApp()` directly.

---

## Errors

- Throw typed domain errors from `domain/errors.ts` (`DeviceNotFoundError`, `DuplicateDeviceError`, `ValidationError`). Never throw bare `Error` or return `null` to signal failure.
- One error handler maps them to HTTP. Every error response has the same shape:

```json
{ "error": { "code": "DEVICE_NOT_FOUND", "message": "..." } }
```

- Internal errors log the detail and return a generic message. Never leak a stack trace to a client.

---

## Tests

- New behaviour ships with its test in the same commit.
- Unit tests for domain and service logic; integration tests go through real HTTP via supertest with a `FakeClock`.
- Test the boundary, not just the happy path. For the timeout that means 0 ms, just under, exactly at, and just over.
- Do not write tests by reading the implementation and asserting what it currently does. Tests are written from the intended behaviour.

---

## Style

- TypeScript `strict`. No `any`. No non-null assertions (`!`) without a comment saying why it is safe.
- Comments explain **why**, never **what**. Delete any comment that restates the line below it.
- No `// Step 1:` / `// Step 2:` narration.
- No emoji in code or comments.
- No `try/catch` around code that cannot throw. No abstractions added "for future flexibility" that have exactly one caller.
- Prefer a plain function over a class when there is no state to hold.
- Keep functions short enough to read without scrolling.

---

## Commits
-You can recommend commits but the final commit will be done by hand by me after reviewing
- Small, focused commits. One concern each.
- Format: `type(scope): summary` — e.g. `feat(domain): derive device status at read time`.
- Where a commit encodes a design decision, the body states the alternative that was rejected and why.
- Do not generate commit messages automatically; they are written by hand.
- `.gitignore` is authoritative — never commit `node_modules`, `dist`, `.env`, or coverage output.

---

## Documentation

- Any change to behaviour, configuration or API shape updates `README.md` in the same commit.
- Assumptions and limitations go in README §9 and §10 rather than being silently absorbed into the code.
