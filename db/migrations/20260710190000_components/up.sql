create table components (
  id integer primary key autoincrement,
  name text not null,
  api_id text not null unique,
  schema text not null,
  created_at integer not null,
  updated_at integer not null
);
