# protege-map — plan interaction builder

Turn a fire/MEP building-plan PDF into an interactive map: locate the מקרא legend,
place a tappable, movable button for every symbol instance, attach data to each.

- **Ingestion** runs in the browser (`pdf.js`) — see [lib/pipeline](lib/pipeline/README.md).
- **Persistence** is Postgres + local files behind Next.js route handlers (this doc).
- **UI** — `/upload` (auto-finds the legend → auto-ingests), `/authoring/[id]`
  (place / move / relabel / delete buttons, publish), `/view/[id]` (pan-zoom, tap a
  button to edit its data, drag to relocate).

## Run with Docker (whole stack)

```bash
docker compose up --build          # http://localhost:3000
```

Brings up Postgres (schema auto-applied on first boot) and the app. Plan data and
the Postgres volume persist across restarts. Stop with `docker compose down`
(add `-v` to wipe the data volumes).

## Run locally (dev)

```bash
npm install                        # postinstall vendors pdf.worker.min.mjs + OSD images into public/
cp .env.example .env               # set DATABASE_URL, STORAGE_DIR
createdb plan_builder
psql "$DATABASE_URL" -f db/schema.sql
npm run dev                        # http://localhost:3000
```

## End-to-end flow

1. `/upload` → pick the PDF. It searches the text layer for `מקרא`, falls back to
   detecting the symbol column by geometry, and — when confident — ingests straight
   away (renders DZI tiles, crops glyphs, OCRs labels, runs detection, `PUT`s every
   asset). Only when detection is unsure does it show a box to nudge. Labels + BOQ
   counts stay available in an optional textarea.
2. `/authoring/[id]` → the auto-detected buttons are already on the plan. Fix
   labels/types, drag misplaced ones, add missed (pick a legend row, click the
   plan), delete false positives. The legend count column (found / BOQ) is the
   checklist. **Publish** when done.
3. `/view/[id]` → end users pan/zoom, tap a button for its `{ label, status, note }`,
   drag to move it.

## Data model

| Table | Purpose |
|---|---|
| `plan` | one uploaded sheet: rendered image path, size, dpi, operator-drawn `legend_rect`, `draft`/`published` |
| `symbol` | one legend row → one button type: `slug`, `label_he`, `expected_count` (BOQ), `row_index` |
| `placement` | one button: `symbol_id`, normalised `x`/`y` (0..1), `fields` jsonb, `source` (`auto`/`manual`), `confidence` |

`fields` is the fixed v1 set — `{ label, status, note }`, `status ∈ planned | installed | issue`
(edit in [lib/domain.ts](lib/domain.ts)).

## API

| Method + path | Body / result |
|---|---|
| `GET /api/plans` | `PlanRow[]` |
| `POST /api/plans` | `{ plan, symbols, placements? }` → `201 PlanBundle`. The browser pipeline's output goes here. |
| `GET /api/plans/:id` | `PlanBundle` (`{ plan, symbols, placements }`) |
| `PATCH /api/plans/:id` | `{ status }` → updated `PlanRow` |
| `DELETE /api/plans/:id` | `204` (cascades) |
| `GET /api/plans/:id/placements` | `PlacementRow[]` |
| `POST /api/plans/:id/placements` | `{ symbolId, x, y, fields? }` → `201 PlacementRow` |
| `PATCH /api/placements/:id` | `{ x?, y?, symbolId?, fields?, updatedBy? }` — move / relabel / reclassify. `fields` merges. |
| `DELETE /api/placements/:id` | `204` |
| `GET /api/plans/:id/assets/*` | streams a stored asset (rendered raster, tiles, glyph crops), immutable-cached |

All handlers are `runtime = "nodejs"` (they use `pg` and the filesystem).

## Storage

[lib/storage.ts](lib/storage.ts) writes under `STORAGE_DIR/plans/<planId>/…` and guards
against path traversal. Swap it for S3/GCS without touching the routes.

## Offline harness

```bash
npm run probe -- /path/to/plan.pdf     # prints legend + detection report, writes candidates.json
```
