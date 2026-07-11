-- Feature flags & A/B experiments. A flag resolves to one of its variants per
-- user. Boolean flags are on/off with targeting; experiments split traffic by
-- weight via deterministic bucketing (no stored assignments). Each variant
-- carries an arbitrary JSON config payload. Flags can start/stop on a schedule.

create table flags (
  id integer primary key autoincrement,
  key text not null unique,
  name text not null,
  description text not null default '',
  kind text not null default 'boolean',           -- 'boolean' | 'experiment'
  enabled integer not null default 0,              -- kill switch
  start_at integer,
  end_at integer,
  lifecycle_state text not null default 'active',  -- 'scheduled' | 'active' | 'ended'
  -- App-validated pointers into flag_variants (NOT foreign keys: a real FK plus
  -- flag_variants.flag_id -> flags is circular; these are NULL-cleared in JS
  -- when the target variant is deleted). off = served when disabled or out of
  -- window; fallthrough = the boolean "on" value (ignored for experiments).
  off_variant_id integer,
  fallthrough_variant_id integer,
  created_at integer not null,
  updated_at integer not null
);

create table flag_variants (
  id integer primary key autoincrement,
  flag_id integer not null references flags(id) on delete cascade,
  key text not null,
  name text not null,
  weight integer not null default 0,               -- 0..100, experiments only
  config text not null default '{}',               -- arbitrary JSON payload
  position integer not null default 0,
  created_at integer not null,
  updated_at integer not null,
  unique (flag_id, key)
);

create table flag_rules (
  id integer primary key autoincrement,
  flag_id integer not null references flags(id) on delete cascade,
  variant_id integer not null references flag_variants(id) on delete cascade,
  attribute text not null,
  operator text not null default 'equals',         -- 'equals' | 'in'
  value text not null default '',                  -- 'in': JSON array string
  position integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);

create index flag_variants_flag_idx on flag_variants (flag_id);

create index flag_rules_flag_idx on flag_rules (flag_id, position);

create index flags_lifecycle_window_idx on flags (lifecycle_state, start_at, end_at);
