create table releases (
  id integer primary key autoincrement,
  name text not null,
  status text not null default 'open',
  scheduled_at integer,
  published_at integer,
  created_at integer not null,
  updated_at integer not null
);

create table release_items (
  id integer primary key autoincrement,
  release_id integer not null references releases(id) on delete cascade,
  entry_id integer not null references entries(id) on delete cascade,
  action text not null default 'publish',
  created_at integer not null,
  unique (release_id, entry_id)
);

create index release_items_release_idx on release_items (release_id);

create index releases_status_scheduled_idx on releases (status, scheduled_at);
