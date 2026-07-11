create table api_tokens (
  id integer primary key autoincrement,
  name text not null,
  token_hash text not null unique,
  created_at integer not null,
  last_used_at integer
);
