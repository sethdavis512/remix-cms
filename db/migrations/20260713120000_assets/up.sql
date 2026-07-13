-- Media library. Uploaded files are stored on local disk (under uploads/) and
-- tracked here: one row per file. Entries reference an asset by its id through
-- a `media` field; the public API expands that id into url/filename/mime/size.
-- uploaded_by is nulled if the uploading user is deleted (the file survives).

create table assets (
  id integer primary key autoincrement,
  filename text not null,
  mime_type text not null,
  size integer not null,
  storage_path text not null,
  uploaded_by integer references users(id) on delete set null,
  created_at integer not null
);

create index assets_created_idx on assets (created_at);
