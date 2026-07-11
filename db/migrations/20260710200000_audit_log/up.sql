create table audit_log (
  id integer primary key autoincrement,
  actor_email text not null,
  action text not null,
  subject_type text not null,
  subject_id integer,
  summary text not null,
  created_at integer not null
);

create index audit_log_created_at_idx on audit_log (created_at);
