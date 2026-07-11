create table webhooks (
  id integer primary key autoincrement,
  name text not null,
  url text not null,
  events text not null,
  enabled integer not null default 1,
  created_at integer not null,
  updated_at integer not null
);
