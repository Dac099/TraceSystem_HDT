# HDT Traceability

Desktop application built with Electron, Vue 3 and TypeScript that traces tools through
two leak-test machines. Each machine has a PLC (EtherNet/IP) and 4 independent stations;
barcode scanners on the network send tooling and plate scans over TCP.

## Setup

1. Edit `config.json` (app root): database credentials, PLC IPs, TCP listen port and the
   scanner IP → stationId map.
2. Run `pnpm dev` to start the desktop app.
3. Run `pnpm build` to type-check and create a production build.

## Architecture

```
config.json → ConfigService → Logger → PostgreSQL (pg, no ORM)
                                     → PlcService ×2 (ethernet-ip v2)
TCP scanners → TcpInterface (:3000) → StationProcess ×8 → toolingRecords
                                    → IPC push → Vue renderer (alarms, live records)
```

- `electron/config.ts` — loads/validates `config.json`, maps stationId (1-8) → PLC + `Server_St[i]` index.
- `electron/logger.ts` — daily log files in `logs/` (`datetime => level => message`), keeps the last 3 days, mirrors to stdout in dev.
- `electron/database.ts` — `pg` pool, creates `toolingRecords` if missing, parameterized queries only.
- `electron/plc-service.ts` — one per PLC: connect with auto-reconnect, initial tag discovery (enables writes), `Scanner` subscriptions on `Server_St[0].HeartBeat` and `Server_St[i].ReqSavePart`, 10 s heartbeat watchdog ("PLC no conectado").
- `electron/tcp-interface.ts` — TCP server on `0.0.0.0:3000`, classifies payloads and emits `ToolingScan` / `PlateScan`. The scanner IP → stationId map is implemented but commented out (scanners not available yet); everything is currently assigned to station `1`.
- `electron/station-process.ts` — serialized per-station workflow: matrix parsing, part/model validation against DB records, `MachineReady` / `CurrentModel` checks, cycle start, record save on `ReqSavePart`, PLC reset handshake.
- `electron/ipc.ts` + `electron/preload.ts` — typed `window.traceability` bridge (records query/latest/CSV export, alarm and record push channels).
- `src/views/ActivityView.vue` — last 100 processed tools, live updates.
- `src/views/RecordsView.vue` — paginated (50) records with filters and CSV export (all rows matching the filters).

## TCP scanner protocol

- **ToolingScan**: `P12815849L26805S2D261950000055` — parsed by index: part number `[0-8]`,
  machine line `[9-14]`, shift `[15-16]`, Julian date `[17-22]`, serial number from `[23]` through
  a maximum of seven characters. The serial is stored for traceability but does not identify the part; identity is the
  nine-character part number.
- **PlateScan**: `Ens_Final_12749631,T1` — `modelId,toolingId`.

## Station cycle rules

- Plate and tooling scans may arrive in either order. The first value waits silently for the second;
  the plate is retained across cycles until another plate is accepted.
- A scan is accepted only when both the local process state and the PLC `CycleStart` tag report no
  cycle. Otherwise the scan is discarded without changing station data and `Proceso en curso` is
  written to the PLC.
- Cycle validation order is: `MachineReady`, scanner values, exact `CurrentModel`/plate match,
  successful `Sub_Ens%` prerequisite for an `Ens_Final%` model, then no prior record for the same
  part number, serial number, and exact model. The serial number is not used for the subassembly prerequisite.
- A part/serial-number combination may run only once for an exact model, regardless of whether that record is OK or nOK.
  Final assembly is allowed only after the same part number has an OK subassembly record.
- After `ReqSavePart`, the result is stored and the PLC receives `Dato guardado`.
  That message remains until another process message overwrites it.

Quick manual test (while `pnpm dev` is running):

```powershell
$c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 3000)
$s = $c.GetStream()
$b = [Text.Encoding]::ASCII.GetBytes("Ens_Final_12749631,T1`n"); $s.Write($b, 0, $b.Length)
$b = [Text.Encoding]::ASCII.GetBytes("P12815849L26805S2D261950000055`n"); $s.Write($b, 0, $b.Length)
$c.Close()
```

## PLC communication

EtherNet/IP via `ethernet-ip` v2 (native STRING/STRUCT support). Tags are addressed as
`Server_St[<stationIndex>].<Member>`, where stationIds 1-4 live on the first PLC and 5-8
on the second. PLC connections live only in the Electron main process; the Vue renderer
reaches them exclusively through the narrow IPC bridge in `electron/preload.ts`.

## Data access

PostgreSQL uses the `pg` driver directly in `electron/database.ts`; no ORM is installed.
Keep all SQL parameterized, e.g. `pool.query('SELECT * FROM "toolingRecords" WHERE id = $1', [id])`.
Camel-case columns are quoted identifiers (`"stationId"`, `"matrixReaded"`, ...).
