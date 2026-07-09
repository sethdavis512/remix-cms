create table users (
  id integer primary key autoincrement,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'admin',
  created_at integer not null,
  updated_at integer not null
);

create table content_types (
  id integer primary key autoincrement,
  name text not null,
  api_id text not null unique,
  api_id_plural text not null unique,
  kind text not null default 'collection',
  schema text not null default '[]',
  created_at integer not null,
  updated_at integer not null
);

create table entries (
  id integer primary key autoincrement,
  content_type_id integer not null references content_types(id) on delete cascade,
  data text not null default '{}',
  status text not null default 'draft',
  published_at integer,
  created_at integer not null,
  updated_at integer not null
);

create index entries_type_status_idx on entries (content_type_id, status);
