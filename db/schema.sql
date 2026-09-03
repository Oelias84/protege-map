-- Plan-interaction schema (Postgres 14+)
-- apply:  psql "$DATABASE_URL" -f db/schema.sql

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- one uploaded sheet ------------------------------------------------------------
create table if not exists plan (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  source_pdf_path text not null,             -- stored original
  image_path      text not null,             -- rendered raster / tile root served to clients
  image_width     integer not null check (image_width  > 0),
  image_height    integer not null check (image_height > 0),
  render_dpi      integer not null check (render_dpi   > 0),
  legend_rect     jsonb,                     -- {x0,y0,x1,y1} device space, operator-drawn
  status          text not null default 'draft' check (status in ('draft','published')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- one legend row -> one button type ------------------------------------------------
create table if not exists symbol (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references plan(id) on delete cascade,
  slug           text not null,              -- stable id within the plan, e.g. 'smoke-detector'
  label_he       text not null,
  glyph_path     text,                       -- cropped glyph image, optional
  row_index      integer not null,
  expected_count integer,                    -- from the BOQ table, optional
  unique (plan_id, slug),
  unique (plan_id, row_index)
);

-- one button on the map ---------------------------------------------------------
create table if not exists placement (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references plan(id) on delete cascade,
  symbol_id   uuid not null references symbol(id) on delete restrict,
  x           double precision not null check (x >= 0 and x <= 1),
  y           double precision not null check (y >= 0 and y <= 1),
  fields      jsonb not null default '{}'::jsonb,   -- {label,status,note}
  source      text not null default 'manual' check (source in ('auto','manual')),
  confidence  real,                                 -- detector score when source='auto'
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists placement_plan_idx   on placement (plan_id);
create index if not exists placement_symbol_idx on placement (symbol_id);
create index if not exists symbol_plan_idx      on symbol (plan_id);

-- keep updated_at fresh --------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists plan_touch on plan;
create trigger plan_touch before update on plan
  for each row execute function touch_updated_at();

drop trigger if exists placement_touch on placement;
create trigger placement_touch before update on placement
  for each row execute function touch_updated_at();
