create table locales (
  id integer primary key autoincrement,
  code text not null unique,
  name text not null,
  is_default integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);

insert into locales (code, name, is_default, created_at, updated_at)
values (
  'en',
  'English',
  1,
  cast(strftime('%s', 'now') as integer) * 1000,
  cast(strftime('%s', 'now') as integer) * 1000
);

alter table content_types add column localized integer not null default 0;

alter table entries add column locale text not null default 'en';

create index entries_type_locale_status_idx on entries (content_type_id, locale, status);
