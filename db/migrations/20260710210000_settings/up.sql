create table settings (
  key text primary key,
  value text not null
);

insert into settings (key, value) values ('require_api_token', 'false');
