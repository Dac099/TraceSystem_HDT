# AGENTS.md

Electron + Vue 3 + TypeScript desktop app (leak-test tool traceability). `README.md` is the
authoritative architecture and protocol doc — read it first; this file only adds what it does
not cover.

## Commands (pnpm only)

- `pnpm dev` — Vite + Electron with hot rebuild of main/preload (vite-plugin-electron).
- `pnpm build` — the **only** verification gate: `vue-tsc --noEmit && vite build`. There are no
  tests, no lint config, and no CI. Run this before considering any change done.
- `pnpm start` — runs Electron against the build output; requires `pnpm build` first.
- `pnpm-workspace.yaml` pre-approves the electron/esbuild build scripts via
  `onlyBuiltDependencies` — keep it, otherwise electron's postinstall is silently skipped.

## Hard-won constraints

- **Never bundle `pg` or `ethernet-ip`.** They must stay in `external` in `vite.config.ts`;
  bundling `pg` turns its optional `pg-native` import into a runtime crash. New runtime deps of
  the Electron main process likely belong in that list too.
- **Main process is ESM** (`"type": "module"`): `__dirname` does not exist — derive it from
  `import.meta.url` as in `electron/main.ts`. The preload builds to `preload.mjs`, not `.js`.
- **`config.json` is required at runtime** (project root in dev). Every key is validated at
  startup and missing keys throw. `CONFIG_PATH` env var overrides the location.
- **`stationIndex` ≠ `stationId`.** PLC tags are `Server_St[stationIndex].Member`, where
  `stationIndex` is the 1-based position of the stationId inside that PLC's `stationIds` array
  in `config.json` (station 5 → `Server_St[1]` on the second PLC). Always go through
  `ConfigService.stationLocation()`; never index tags by stationId directly.
- **stationId is a `string` in TCP payloads and the DB** (`'1'`–`'8'`) but a `number` in
  `config.json`. The stations map in `main.ts` is keyed by string.
- **The scanner IP → station map is deliberately disabled** (`resolveStationId` in
  `electron/tcp-interface.ts`, TODO `scanners`). All scans route to station `'1'` until the
  physical scanners exist — do not "fix" this.
- **Startup order matters**: `ConfigService.load()` → `Logger.init()` → everything else. Both
  are singletons whose `get()` throws if called before init. The app intentionally stays alive
  when the DB or a PLC is unreachable — failures surface as renderer alarms, not crashes.
- **Raw SQL only** — no ORM. Parameterize (`$1`, `$2`); camelCase columns are quoted
  identifiers (`"stationId"`) and must stay quoted or Postgres folds them to lowercase.
- **User-facing strings are Spanish** ("PLC no conectado", "Actividad", "Registros") — match
  that when adding UI text or alarms.

## Adding an IPC channel

Three coordinated edits: expose on `window.traceability` in `electron/preload.ts`, handler in
`electron/ipc.ts`, renderer types in `src/env.d.ts`. `ToolingRecord` is declared twice on
purpose (`electron/database.ts` with `createdAt: Date`, `src/types.ts` with `string`) because
the renderer cannot import from `electron/`.

## Smoke test

With `pnpm dev` running, use the README's PowerShell snippet to send ToolingScan/PlateScan
payloads to TCP port 3000. Without reachable PLCs/DB, expect UI alarms and entries in
`logs/app-YYYY-MM-DD.log` (`datetime => level => message`).
